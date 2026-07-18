import 'dotenv/config';
import { loadConfig, assertSafePilotConfig } from '../src/config.js';
import { InstagramPlaywrightDriver } from '../src/browser/InstagramPlaywrightDriver.js';
import { validateStagingIsolation } from '../../shared/stagingIsolation.js';

validateStagingIsolation(process.env, { requireDatabaseUrl: false });
const config = loadConfig(); assertSafePilotConfig(config);
const driver = new InstagramPlaywrightDriver({ config, diagnostics: null, safety: { beforeConversationOpen: async () => {} } });
await driver.connect({ headed: true });
await driver.openLogin();
console.log('سجّل الدخول يدويًا وأكمل 2FA. لن يقرأ البرنامج كلمة المرور أو رمز التحقق.');
const finish = async () => {
  await driver.openInbox().catch(() => {});
  const status = await driver.detectSession();
  if (status === 'authenticated') await driver.persistStorageState();
  console.log(status === 'authenticated' ? 'تم حفظ جلسة الحساب التجريبي.' : `الجلسة غير جاهزة: ${status}`);
  await driver.disconnect(); process.exit(status === 'authenticated' ? 0 : 1);
};

if (String(process.env.INSTAGRAM_LOGIN_AUTO_CONFIRM || '').toLowerCase() === 'true') {
  console.log('سيتم التحقق تلقائيًا من نجاح تسجيل الدخول دون قراءة بيانات النموذج.');
  const deadline = Date.now() + Number(process.env.INSTAGRAM_LOGIN_TIMEOUT_MS || 900_000);
  const timer = setInterval(async () => {
    if (Date.now() >= deadline) {
      clearInterval(timer);
      await driver.disconnect();
      process.exit(2);
    }
    const status = await driver.detectSession().catch(() => 'unknown');
    if (status === 'authenticated') {
      clearInterval(timer);
      await finish();
    }
  }, 2_000);
} else {
  console.log('بعد ظهور Direct Inbox، اضغط Enter هنا لحفظ الجلسة داخل الـPersistent Profile.');
  process.stdin.setEncoding('utf8'); process.stdin.resume();
  process.stdin.once('data', finish);
}
