import { loadDotEnv, inferenceEnvSchema } from '../src/config/env.js';
import { createZeroG, InferenceError } from '../src/integrations/zero-g.js';

try {
  loadDotEnv();
  const result = await createZeroG(inferenceEnvSchema.parse(process.env))('Return only JSON: {"ok":true}', {});
  const value: unknown = JSON.parse(result.text);
  if (JSON.stringify(value) !== '{"ok":true}') throw new InferenceError('invalid_output');
  console.log(JSON.stringify({ status: 'ok', model: result.model, providerRequestId: result.providerRequestId, tokens: result.tokens }));
} catch (error) {
  console.error(error instanceof InferenceError ? error.code : 'smoke_failed');
  process.exitCode = 1;
}
