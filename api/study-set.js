import { buildGenerateRequest } from '../backend/pipeline.js';
import { createStudySetHandler } from './_handler.js';

/** POST /api/study-set — free-form text in, validated study set out. */
export default createStudySetHandler(buildGenerateRequest);
