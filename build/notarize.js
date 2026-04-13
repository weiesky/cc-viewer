import { notarize } from '@electron/notarize';

export default async function notarizing(context) {
  const { electronPlatformName, appOutDir } = context;

  // 只对 macOS 进行公证
  if (electronPlatformName !== 'darwin') {
    return;
  }

  const appName = context.packager.appInfo.productFilename;
  const appPath = `${appOutDir}/${appName}.app`;

  // 检查必需的环境变量
  const appleId = process.env.APPLE_ID;
  const appleIdPassword = process.env.APPLE_APP_SPECIFIC_PASSWORD;
  const teamId = process.env.APPLE_TEAM_ID;

  if (!appleId || !appleIdPassword || !teamId) {
    console.warn('⚠️  跳过公证: 缺少必需的环境变量');
    console.warn('   需要设置: APPLE_ID, APPLE_APP_SPECIFIC_PASSWORD, APPLE_TEAM_ID');
    return;
  }

  const NOTARIZE_TIMEOUT = 45 * 60 * 1000; // 45 minutes (must be less than CI's 60min timeout)
  console.log(`🔐 开始公证 ${appName}.app (超时: ${NOTARIZE_TIMEOUT / 60000} 分钟)...`);

  try {
    await Promise.race([
      notarize({ appPath, appleId, appleIdPassword, teamId }),
      new Promise((_, reject) => setTimeout(() => reject(new Error('Notarization timed out')), NOTARIZE_TIMEOUT)),
    ]);
    console.log('✅ 公证成功！');
  } catch (error) {
    if (error.message === 'Notarization timed out') {
      console.warn('⚠️  公证超时，跳过公证继续打包');
      return;
    }
    console.error('❌ 公证失败:', error.message);
    console.warn('⚠️  忽略公证失败，继续打包');
  }
}
