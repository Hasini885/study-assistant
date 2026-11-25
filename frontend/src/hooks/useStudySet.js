import { useCallback, useEffect, useReducer, useRef } from 'react';
import { ApiError, createStudySet, refineStudySet } from '../api/client.js';

/**
 * Owns the request lifecycle for a study set.
 *
 * Two independent guards keep a stale response from overwriting a newer one:
 *
 *  1. Every new request aborts the previous one's fetch.
 *  2. Every request carries a sequence number, and the reducer ignores any
 *     result whose number is not the latest.
 *
 * (1) alone is not enough — a response can already be in flight, or resolve in
 * the same tick the abort fires, so the slower of two overlapping requests
 * could still land last. (2) is the actual correctness guarantee; (1) is the
 * optimisation that stops us paying for work nobody wants.
 */

const initialState = {
  status: 'idle', // idle | loading | refining | ready | error
  studySet: null,
  meta: null,
  error: null,
  lastRequest: null, // replayed by the Retry button
  partial: null, // items that have streamed in so far, while status is 'loading'
};

function reducer(state, action) {
  // Anything tagged with an out-of-date sequence number is a stale response.
  if (action.seq !== undefined && action.seq !== action.currentSeq) return state;

  switch (action.type) {
    case 'start':
      return {
        ...state,
        status: action.mode === 'refine' ? 'refining' : 'loading',
        error: null,
        // A refinement keeps the current set on screen; a fresh generate clears it.
        studySet: action.mode === 'refine' ? state.studySet : null,
        meta: action.mode === 'refine' ? state.meta : null,
        lastRequest: action.request,
        partial: null,
      };

    case 'partial':
      // A preview while generating; it never replaces a set already on screen.
      return state.status === 'loading' ? { ...state, partial: action.studySet } : state;

    case 'success':
      return { ...state, status: 'ready', studySet: action.studySet, meta: action.meta, error: null, partial: null };

    case 'failure':
      return {
        ...state,
        // A failed refinement must not destroy the set the user already has.
        status: state.studySet ? 'ready' : 'error',
        error: action.error,
        partial: null,
      };

    case 'cancel':
      return { ...state, status: state.studySet ? 'ready' : 'idle', error: null, partial: null };

    case 'load':
      return { ...initialState, status: 'ready', studySet: action.studySet, meta: action.meta };

    case 'dismissError':
      return { ...state, error: null };

    case 'reset':
      return initialState;

    default:
      return state;
  }
}

export { reducer as studySetReducer, initialState as initialStudySetState };

export function useStudySet() {
  const [state, dispatch] = useReducer(reducer, initialState);

  const seqRef = useRef(0);
  const controllerRef = useRef(null);

  // Abort whatever is in flight if the component goes away.
  useEffect(() => () => controllerRef.current?.abort(), []);

  const send = useCallback(async (request) => {
    const seq = ++seqRef.current;

    controllerRef.current?.abort();
    const controller = new AbortController();
    controllerRef.current = controller;

    dispatch({ type: 'start', mode: request.mode, request });

    try {
      const result =
        request.mode === 'refine'
          ? await refineStudySet(request.payload, controller.signal)
          : await createStudySet(request.payload, controller.signal, {
              // Streamed items pass through the same sequence check as the
              // final result, so a superseded stream can't paint over a newer one.
              onPartial: (studySet) => dispatch({ type: 'partial', studySet, seq, currentSeq: seqRef.current }),
            });

      dispatch({ type: 'success', ...result, seq, currentSeq: seqRef.current });
    } catch (error) {
      if (error.name === 'AbortError') return; // superseded or cancelled on purpose
      dispatch({
        type: 'failure',
        error: toApiError(error),
        seq,
        currentSeq: seqRef.current,
      });
    }
  }, []);

  const generate = useCallback(({ input }) => send({ mode: 'generate', payload: { input } }), [send]);

  const refine = useCallback(
    ({ studySet, instruction }) => send({ mode: 'refine', payload: { studySet, instruction } }),
    [send]
  );

  const retry = useCallback(() => {
    if (state.lastRequest) send(state.lastRequest);
  }, [send, state.lastRequest]);

  const cancel = useCallback(() => {
    // Bump the sequence so an in-flight response can never be applied later.
    seqRef.current += 1;
    controllerRef.current?.abort();
    dispatch({ type: 'cancel' });
  }, []);

  const load = useCallback((studySet, meta) => {
    seqRef.current += 1;
    controllerRef.current?.abort();
    dispatch({ type: 'load', studySet, meta });
  }, []);

  const reset = useCallback(() => {
    seqRef.current += 1;
    controllerRef.current?.abort();
    dispatch({ type: 'reset' });
  }, []);

  const dismissError = useCallback(() => dispatch({ type: 'dismissError' }), []);

  return { ...state, generate, refine, retry, cancel, load, reset, dismissError };
}

function toApiError(error) {
  if (error instanceof ApiError) return { code: error.code, message: error.message, retryable: error.retryable };
  return { code: 'unknown', message: error?.message || 'Something went wrong.', retryable: true };
}
