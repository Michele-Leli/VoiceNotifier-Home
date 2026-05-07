const { withAndroidManifest, withProjectBuildGradle, withAppBuildGradle } = require('@expo/config-plugins');

const withNotificationListener = (config) => {
  // Add JitPack repository and ensure Kotlin version
  config = withProjectBuildGradle(config, (config) => {
    let contents = config.modResults.contents;

    // Add JitPack
    if (!contents.includes('https://jitpack.io')) {
      const allProjectsRepositoriesRegex = /allprojects\s*\{\s*repositories\s*\{/;
      if (allProjectsRepositoriesRegex.test(contents)) {
        contents = contents.replace(
          allProjectsRepositoriesRegex,
          'allprojects {\n    repositories {\n        maven { url "https://jitpack.io" }'
        );
      }
    }

    // Force Kotlin version for compatibility
    const kotlinVersionTarget = '2.0.0';
    
    if (contents.includes('kotlinVersion =')) {
      // Se esiste già, la sostituiamo
      contents = contents.replace(/kotlinVersion\s*=\s*".*"/g, `kotlinVersion = "${kotlinVersionTarget}"`);
      contents = contents.replace(/kotlinVersion\s*=\s*'.*'/g, `kotlinVersion = "${kotlinVersionTarget}"`);
    } else {
      // Se non esiste (improbabile in Expo), la aggiungiamo nel blocco ext
      const extBlockRegex = /ext\s*\{/;
      if (extBlockRegex.test(contents)) {
        contents = contents.replace(extBlockRegex, `ext {\n        kotlinVersion = "${kotlinVersionTarget}"`);
      }
    }

    config.modResults.contents = contents;
    return config;
  });

  return withAndroidManifest(config, async (config) => {
    const androidManifest = config.modResults;
    const manifest = androidManifest.manifest;
    const mainApplication = manifest.application[0];

    // Ensure permissions are present
    if (!manifest['uses-permission']) {
      manifest['uses-permission'] = [];
    }
    
    // Use android namespaced names for certainty
    const requiredPermissions = [
      'android.permission.FOREGROUND_SERVICE',
      'android.permission.FOREGROUND_SERVICE_SPECIAL_USE',
      'android.permission.RECEIVE_BOOT_COMPLETED',
      'android.permission.WAKE_LOCK'
    ];

    requiredPermissions.forEach(perm => {
      if (!manifest['uses-permission'].find(p => p.$['android:name'] === perm)) {
        manifest['uses-permission'].push({ $: { 'android:name': perm } });
      }
    });

    // Aggiunta namespace tools per gestire i conflitti di merge
    if (!androidManifest.manifest.$) {
      androidManifest.manifest.$ = {};
    }
    if (!androidManifest.manifest.$['xmlns:tools']) {
      androidManifest.manifest.$['xmlns:tools'] = 'http://schemas.android.com/tools';
    }

    // Risoluzione conflitti comuni
    if (!mainApplication.$) {
      mainApplication.$ = {};
    }
    mainApplication.$['android:allowBackup'] = 'false';
    mainApplication.$['android:largeHeap'] = 'true';
    
    // Gestione tools:replace
    let existingReplace = mainApplication.$['tools:replace'] || '';
    let replaceItems = existingReplace ? existingReplace.split(',').map(s => s.trim()).filter(Boolean) : [];
    
    ['android:allowBackup', 'android:largeHeap', 'android:label', 'android:icon'].forEach(item => {
      if (!replaceItems.includes(item)) replaceItems.push(item);
    });
    
    mainApplication.$['tools:replace'] = replaceItems.join(',');

    // Ensure the services are registered
    if (!mainApplication.service) {
      mainApplication.service = [];
    }

    // Add RNAndroidNotificationListener
    if (!mainApplication.service.find(s => s.$['android:name'] === 'com.lesimoes.androidnotificationlistener.RNAndroidNotificationListener')) {
      mainApplication.service.push({
        $: {
          'android:name': 'com.lesimoes.androidnotificationlistener.RNAndroidNotificationListener',
          'android:permission': 'android.permission.BIND_NOTIFICATION_LISTENER_SERVICE',
          'android:exported': 'true',
          'android:label': 'VoxHome Listener',
          'android:foregroundServiceType': 'specialUse'
        },
        'intent-filter': [
          {
            action: [
              {
                $: {
                  'android:name': 'android.service.notification.NotificationListenerService',
                },
              },
            ],
          },
        ],
      });
    }

    // Add RNAndroidNotificationListenerHeadlessJsTaskService
    if (!mainApplication.service.find(s => s.$['android:name'] === 'com.lesimoes.androidnotificationlistener.RNAndroidNotificationListenerHeadlessJsTaskService')) {
      mainApplication.service.push({
        $: {
          'android:name': 'com.lesimoes.androidnotificationlistener.RNAndroidNotificationListenerHeadlessJsTaskService',
        },
      });
    }

    // Add BootUpReceiver
    if (!mainApplication.receiver) {
      mainApplication.receiver = [];
    }
    if (!mainApplication.receiver.find(r => r.$['android:name'] === 'com.lesimoes.androidnotificationlistener.BootUpReceiver')) {
      mainApplication.receiver.push({
        $: {
          'android:name': 'com.lesimoes.androidnotificationlistener.BootUpReceiver',
          'android:enabled': 'true',
          'android:exported': 'true',
          'android:permission': 'android.permission.RECEIVE_BOOT_COMPLETED',
        },
        'intent-filter': [
          {
            action: [
              {
                $: {
                  'android:name': 'android.intent.action.BOOT_COMPLETED',
                },
              },
            ],
            category: [
              {
                $: {
                  'android:name': 'android.intent.category.DEFAULT',
                },
              },
            ],
          },
        ],
      });
    }

    return config;
  });
};

module.exports = withNotificationListener;
