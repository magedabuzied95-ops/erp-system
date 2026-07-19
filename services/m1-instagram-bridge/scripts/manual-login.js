import 'dotenv/config';
import { loadConfig, assertSafePilotConfig } from '../src/config.js';
import { InstagramPlaywrightDriver } from '../src/browser/InstagramPlaywrightDriver.js';
import { isOperationalSessionReady } from '../src/domain/health.js';
import { validateStagingIsolation } from '../../shared/stagingIsolation.js';

validateStagingIsolation(process.env, { requireDatabaseUrl: false });
const config = loadConfig(); assertSafePilotConfig(config);
const driver = new InstagramPlaywrightDriver({ config, diagnostics: null, safety: { beforeConversationOpen: async () => {} } });
await driver.connect({ headed: true });
await driver.openLogin();
console.log('سجّل الدخول يدويًا وأكمل 2FA. لن يقرأ البرنامج كلمة المرور أو رمز التحقق.');
const finish = async ({ exitOnFailure = true } = {}) => {
  await driver.openInbox().catch(() => {});
  const probe = await driver.getHealthProbe();
  const ready = isOperationalSessionReady(probe);
  if (ready) {
    await driver.persistStorageState();
    console.log('تم حفظ جلسة الحساب التجريبي بعد التحقق من Direct Inbox.');
    await driver.disconnect();
    process.exit(0);
  }
  console.log(`الجلسة لم تصل إلى Direct Inbox بعد: ${probe.session}`);
  if (exitOnFailure) {
    await driver.disconnect();
    process.exit(1);
  }
  return false;
};

if (String(process.env.INSTAGRAM_LOGIN_AUTO_CONFIRM || '').toLowerCase() === 'true') {
  console.log('سيتم التحقق تلقائيًا من نجاح تسجيل الدخول دون قراءة بيانات النموذج.');
  const deadline = Date.now() + Number(process.env.INSTAGRAM_LOGIN_TIMEOUT_MS || 900_000);
  let checking = false;
  const timer = setInterval(async () => {
    if (checking) return;
    checking = true;
    if (Date.now() >= deadline) {
      clearInterval(timer);
      await driver.disconnect();
      process.exit(2);
    }
    try {
      const status = await driver.detectSession().catch(() => 'unknown');
      if (status === 'authenticated') await finish({ exitOnFailure: false });
    } finally {
      checking = false;
    }
  }, 2_000);
} else {
  console.log('بعد ظهور Direct Inbox، اضغط Enter هنا لحفظ الجلسة داخل الـPersistent Profile.');
  process.stdin.setEncoding('utf8'); process.stdin.resume();
  process.stdin.once('data', finish);
}
