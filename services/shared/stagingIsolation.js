const normalize = (value) => String(value || '').trim().toLowerCase();

function databaseNameFromUrl(value) {
  try {
    const parsed = new URL(String(value || ''));
    return decodeURIComponent(parsed.pathname.replace(/^\//, ''));
  } catch {
    return '';
  }
}

export function validateStagingIsolation(env = process.env, options = {}) {
  const required = normalize(env.STAGING_ISOLATION_REQUIRED) === 'true';
  if (!required) return Object.freeze({ required: false, valid: true });

  const violations = [];
  const expectedDatabase = normalize(env.STAGING_EXPECTED_DATABASE || 'erp_staging');
  const declaredDatabase = normalize(env.DATABASE_NAME);
  const databaseUrlName = databaseNameFromUrl(env.DATABASE_URL);
  const requireDatabaseUrl = options.requireDatabaseUrl !== false;

  if (normalize(env.APP_ENV) !== 'staging') violations.push('app_env_must_be_staging');
  if (normalize(env.DOCKER_PROJECT) !== 'm1-staging') violations.push('docker_project_must_be_m1_staging');
  if (normalize(env.CHANNEL_ACCOUNT_TYPE) !== 'test') violations.push('channel_account_type_must_be_test');
  if (declaredDatabase !== expectedDatabase) violations.push('database_name_must_be_erp_staging');
  if (requireDatabaseUrl && databaseUrlName !== expectedDatabase) violations.push('database_url_must_target_erp_staging');

  const forbiddenNames = ['erp_db', 'postgres', 'production', 'prod'];
  if (forbiddenNames.includes(declaredDatabase) || forbiddenNames.includes(databaseUrlName)) violations.push('production_database_forbidden');

  const publicOrigin = normalize(env.STAGING_PUBLIC_ORIGIN);
  const originHost = publicOrigin.replace(/^https?:\/\//, '');
  if (publicOrigin && /(^|\.)m1store-egy\.com(?::|\/|$)/.test(originHost)
      && !publicOrigin.includes('staging-') && !publicOrigin.includes('inbox-staging.')) {
    violations.push('production_domain_forbidden');
  }

  const accountId = normalize(env.INSTAGRAM_CHANNEL_ACCOUNT_ID);
  if (accountId && accountId !== 'instagram-test-account') violations.push('production_channel_account_forbidden');

  if (violations.length) {
    const error = new Error(`staging_isolation_violation: ${violations.join(', ')}`);
    error.code = 'staging_isolation_violation';
    error.violations = violations;
    throw error;
  }

  return Object.freeze({ required: true, valid: true, databaseName: expectedDatabase });
}
