import { validateStagingIsolation } from '../../services/shared/stagingIsolation.js';

try {
  const result = validateStagingIsolation(process.env);
  process.stdout.write(`${JSON.stringify({ event: 'staging.isolation.validated', required: result.required })}\n`);
} catch (error) {
  process.stderr.write(`${JSON.stringify({ event: 'staging.isolation.rejected', code: error.code || 'staging_isolation_violation', violations: error.violations || [] })}\n`);
  process.exit(78);
}
