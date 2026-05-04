const { withAndroidManifest } = require('@expo/config-plugins');

const withNotificationListener = (config) => {
  return withAndroidManifest(config, async (config) => {
    const androidManifest = config.modResults;
    const manifest = androidManifest.manifest;
    const mainApplication = manifest.application[0];

    // Add tools namespace
    if (!manifest.$['xmlns:tools']) {
      manifest.$['xmlns:tools'] = 'http://schemas.android.com/tools';
    }

    // Set allowBackup and tools:replace to avoid merge conflicts
    mainApplication.$['android:allowBackup'] = 'false';
    if (!mainApplication.$['tools:replace']) {
      mainApplication.$['tools:replace'] = 'android:allowBackup';
    } else if (!mainApplication.$['tools:replace'].includes('android:allowBackup')) {
      mainApplication.$['tools:replace'] += ',android:allowBackup';
    }

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
          'android:label': 'VoxHome Notification Listener'
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
