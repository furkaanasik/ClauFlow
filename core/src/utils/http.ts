/**
 * Express JSON body limit. Task descriptions, comments and breakdown prompts
 * accept up to 500 000 characters (a pasted design doc); multi-byte UTF-8 and
 * JSON escaping can grow that several-fold, so the limit is well above it.
 */
export const JSON_BODY_LIMIT = "5mb";

/** Cap on a comment body or a breakdown prompt (characters). */
export const LONG_TEXT_MAX_CHARS = 500_000;
