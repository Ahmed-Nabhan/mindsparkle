// Push Notification Service - Study reminders and streak notifications
// Uses Expo Notifications

import * as Notifications from 'expo-notifications';
import { Platform } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';

const STORAGE_KEYS = {
  NOTIFICATION_TOKEN: '@mindsparkle_push_token',
  NOTIFICATION_SETTINGS: '@mindsparkle_notification_settings',
};

export interface NotificationSettings {
  studyReminders: boolean;
  streakReminders: boolean;
  quizChallenges: boolean;
  newFeatures: boolean;
  reminderTime: string; // HH:MM format
  reminderDays: number[]; // 0-6, Sunday-Saturday
}

const DEFAULT_SETTINGS: NotificationSettings = {
  studyReminders: true,
  streakReminders: true,
  quizChallenges: true,
  newFeatures: true,
  reminderTime: '19:00', // 7 PM
  reminderDays: [0, 1, 2, 3, 4, 5, 6], // Every day
};

// Notification content templates
const NOTIFICATION_TEMPLATES = {
  studyReminder: [
    { title: '📚 Time to Study!', body: "Your brain is ready for new knowledge. Let's learn something today!" },
    { title: '🧠 Keep Learning!', body: 'A few minutes of study can make a big difference. Ready?' },
    { title: '✨ Study Break Time?', body: 'Take a break from your routine and learn something new!' },
    { title: '🎯 Daily Goal', body: "You haven't studied today. Let's keep that streak going!" },
  ],
  streakWarning: [
    { title: '🔥 Streak at Risk!', body: "Don't lose your learning streak! Study now to keep it alive." },
    { title: '⚠️ Streak Alert', body: 'Your streak is about to end! Quick study session?' },
    { title: '💪 Keep Going!', body: "You're on a roll! Don't break the chain today." },
  ],
  streakAchievement: [
    { title: '🔥 Streak Extended!', body: 'Amazing! You just extended your learning streak!' },
    { title: '🎉 Streak Milestone!', body: "You're on fire! Keep up the great work!" },
  ],
  quizChallenge: [
    { title: '🧩 Quiz Time!', body: 'Test your knowledge with a quick quiz on your recent topics.' },
    { title: '🎯 Challenge Yourself', body: 'New quiz available! Can you beat your high score?' },
  ],
};

class NotificationService {
  private expoPushToken: string | null = null;
  private settings: NotificationSettings = DEFAULT_SETTINGS;

  // Initialize notifications
  async initialize(): Promise<boolean> {
    // Check if running on physical device (simulator won't have push token)
    if (Platform.OS === 'web') {
      console.log('Notifications not supported on web');
      return false;
    }

    try {
      // Configure notification handler
      Notifications.setNotificationHandler({
        handleNotification: async () => ({
          shouldShowAlert: true,
          shouldPlaySound: true,
          shouldSetBadge: true,
        }),
      });

      // Request permissions
      const { status: existingStatus } = await Notifications.getPermissionsAsync();
      let finalStatus = existingStatus;

      if (existingStatus !== 'granted') {
        const { status } = await Notifications.requestPermissionsAsync();
        finalStatus = status;
      }

      if (finalStatus !== 'granted') {
        console.log('Notification permissions not granted');
        return false;
      }

      // Get push token
      const token = await Notifications.getExpoPushTokenAsync();
      this.expoPushToken = token.data;
      await AsyncStorage.setItem(STORAGE_KEYS.NOTIFICATION_TOKEN, token.data);

      // Load settings
      await this.loadSettings();

      // Schedule default notifications
      await this.scheduleStudyReminders();

      // Android-specific channel setup
      if (Platform.OS === 'android') {
        await this.setupAndroidChannels();
      }

      return true;
    } catch (error) {
      console.error('Error initializing notifications:', error);
      return false;
    }
  }

  // Setup Android notification channels
  private async setupAndroidChannels(): Promise<void> {
    await Notifications.setNotificationChannelAsync('study-reminders', {
      name: 'Study Reminders',
      importance: Notifications.AndroidImportance.HIGH,
      vibrationPattern: [0, 250, 250, 250],
      lightColor: '#1E3A8A',
    });

    await Notifications.setNotificationChannelAsync('streaks', {
      name: 'Streak Notifications',
      importance: Notifications.AndroidImportance.HIGH,
      vibrationPattern: [0, 250, 250, 250],
      lightColor: '#F59E0B',
    });

    await Notifications.setNotificationChannelAsync('general', {
      name: 'General',
      importance: Notifications.AndroidImportance.DEFAULT,
    });
  }

  // Load notification settings
  async loadSettings(): Promise<NotificationSettings> {
    try {
      const data = await AsyncStorage.getItem(STORAGE_KEYS.NOTIFICATION_SETTINGS);
      if (data) {
        this.settings = { ...DEFAULT_SETTINGS, ...JSON.parse(data) };
      }
    } catch (error) {
      console.error('Error loading notification settings:', error);
    }
    return this.settings;
  }

  // Save notification settings
  async saveSettings(settings: Partial<NotificationSettings>): Promise<void> {
    this.settings = { ...this.settings, ...settings };
    await AsyncStorage.setItem(
      STORAGE_KEYS.NOTIFICATION_SETTINGS,
      JSON.stringify(this.settings)
    );

    // Reschedule notifications with new settings
    await this.cancelAllScheduled();
    await this.scheduleStudyReminders();
  }

  // Get current settings
  getSettings(): NotificationSettings {
    return { ...this.settings };
  }

  // Schedule daily study reminders
  async scheduleStudyReminders(): Promise<void> {
    if (!this.settings.studyReminders) return;

    const [hours, minutes] = this.settings.reminderTime.split(':').map(Number);

    for (const day of this.settings.reminderDays) {
      const template = this.getRandomTemplate('studyReminder');
      
      await Notifications.scheduleNotificationAsync({
        content: {
          title: template.title,
          body: template.body,
          data: { type: 'study_reminder' },
        },
        trigger: {
          type: Notifications.SchedulableTriggerInputTypes.WEEKLY,
          weekday: day + 1, // Expo uses 1-7, Sunday-Saturday
          hour: hours,
          minute: minutes,
        },
      });
    }
  }

  // Schedule streak warning notification
  async scheduleStreakWarning(hoursUntilMidnight: number): Promise<void> {
    if (!this.settings.streakReminders) return;

    // Cancel existing streak warnings
    await this.cancelNotificationsByType('streak_warning');

    // Schedule new warning 2 hours before midnight
    if (hoursUntilMidnight <= 3 && hoursUntilMidnight > 0) {
      const template = this.getRandomTemplate('streakWarning');
      
      await Notifications.scheduleNotificationAsync({
        content: {
          title: template.title,
          body: template.body,
          data: { type: 'streak_warning' },
        },
        trigger: {
          type: Notifications.SchedulableTriggerInputTypes.TIME_INTERVAL,
          seconds: Math.max(1, hoursUntilMidnight * 3600 - 7200), // 2 hours before midnight
        },
      });
    }
  }

  // Send immediate notification
  async sendNotification(
    title: string,
    body: string,
    data?: Record<string, any>
  ): Promise<void> {
    await Notifications.scheduleNotificationAsync({
      content: {
        title,
        body,
        data: data || {},
      },
      trigger: null, // Immediate
    });
  }

  // Send streak achievement notification
  async sendStreakAchievement(streakDays: number): Promise<void> {
    const template = this.getRandomTemplate('streakAchievement');
    
    await this.sendNotification(
      template.title,
      `${streakDays} days and counting! ${template.body}`,
      { type: 'streak_achievement', streakDays }
    );
  }

  // Send level up notification
  async sendLevelUpNotification(newLevel: number, levelTitle: string): Promise<void> {
    await this.sendNotification(
      '🎉 Level Up!',
      `Congratulations! You've reached Level ${newLevel}: ${levelTitle}`,
      { type: 'level_up', level: newLevel }
    );
  }

  // Send achievement unlocked notification
  async sendAchievementNotification(achievementTitle: string, achievementIcon: string): Promise<void> {
    await this.sendNotification(
      `${achievementIcon} Achievement Unlocked!`,
      `You earned "${achievementTitle}"! Keep up the great work!`,
      { type: 'achievement' }
    );
  }

  // Get random notification template
  private getRandomTemplate(type: keyof typeof NOTIFICATION_TEMPLATES): { title: string; body: string } {
    const templates = NOTIFICATION_TEMPLATES[type];
    return templates[Math.floor(Math.random() * templates.length)];
  }

  // Cancel all scheduled notifications
  async cancelAllScheduled(): Promise<void> {
    await Notifications.cancelAllScheduledNotificationsAsync();
  }

  // Cancel notifications by type
  async cancelNotificationsByType(type: string): Promise<void> {
    const scheduled = await Notifications.getAllScheduledNotificationsAsync();
    
    for (const notification of scheduled) {
      if (notification.content.data?.type === type) {
        await Notifications.cancelScheduledNotificationAsync(notification.identifier);
      }
    }
  }

  // Get push token
  getPushToken(): string | null {
    return this.expoPushToken;
  }

  // Add notification listener
  addNotificationListener(
    callback: (notification: Notifications.Notification) => void
  ): Notifications.Subscription {
    return Notifications.addNotificationReceivedListener(callback);
  }

  // Add response listener (when user taps notification)
  addResponseListener(
    callback: (response: Notifications.NotificationResponse) => void
  ): Notifications.Subscription {
    return Notifications.addNotificationResponseReceivedListener(callback);
  }

  // Get badge count
  async getBadgeCount(): Promise<number> {
    return await Notifications.getBadgeCountAsync();
  }

  // Set badge count
  async setBadgeCount(count: number): Promise<void> {
    await Notifications.setBadgeCountAsync(count);
  }

  // Clear badge
  async clearBadge(): Promise<void> {
    await Notifications.setBadgeCountAsync(0);
  }
}

export const notificationService = new NotificationService();
export default notificationService;
