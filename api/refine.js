import { buildRefineRequest } from '../server/pipeline.js';
import { createStudySetHandler } from './_handler.js';

/** POST /api/refine — edit an existing set instead of regenerating it. */
export default createStudySetHandler(buildRefineRequest);
