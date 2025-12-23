import React from 'react';
import { createStackNavigator } from '@react-navigation/stack';
import { createDrawerNavigator } from '@react-navigation/drawer';
import { Sidebar } from '../components/Sidebar';
import { colors } from '../constants/colors';
import { strings } from '../constants/strings';

// Screens
import { WelcomeScreen } from '../screens/WelcomeScreen';
import { HomeScreen } from '../screens/HomeScreen';
import { UploadScreen } from '../screens/UploadScreen';
import { DocumentActionsScreen } from '../screens/DocumentActionsScreen';
import { SummaryScreen } from '../screens/SummaryScreen';
import { StudyScreen } from '../screens/StudyScreen';
import { VideoScreen } from '../screens/VideoScreen';
import { TestScreen } from '../screens/TestScreen';
import { LabsScreen } from '../screens/LabsScreen';
import { PerformanceScreen } from '../screens/PerformanceScreen';
import { ExamsScreen } from '../screens/ExamsScreen';
import { InterviewScreen } from '../screens/InterviewScreen';

// New Screens
import { AuthScreen } from '../screens/AuthScreen';
import { PaywallScreen } from '../screens/PaywallScreen';
import { FlashcardScreen } from '../screens/FlashcardScreen';
import { ChatScreen } from '../screens/ChatScreen';
import { AchievementsScreen } from '../screens/AchievementsScreen';
import { AudioPlayerScreen } from '../screens/AudioPlayerScreen';
import { FoldersScreen } from '../screens/FoldersScreen';
import { SettingsScreen } from '../screens/SettingsScreen';

import type { RootStackParamList, MainDrawerParamList } from './types';

const Stack = createStackNavigator<RootStackParamList>();
const Drawer = createDrawerNavigator<MainDrawerParamList>();

const MainDrawer = () => {
  return (
    <Drawer. Navigator
      drawerContent={(props) => <Sidebar {...props} />}
      screenOptions={{
        headerStyle: {
          backgroundColor: colors.primary,
        },
        headerTintColor: '#FFFFFF',
        headerTitleStyle: {
          fontWeight:  'bold',
        },
        drawerActiveTintColor: colors.primary,
        drawerInactiveTintColor:  colors.textSecondary,
      }}
    >
      <Drawer. Screen 
        name="Home" 
        component={HomeScreen}
        options={{
          title: strings.home. title,
        }}
      />
      <Drawer. Screen 
        name="Upload" 
        component={UploadScreen}
        options={{
          title: strings.upload. title,
        }}
      />
      <Drawer.Screen 
        name="DocumentActions" 
        component={DocumentActionsScreen}
        options={{
          title:  'Document Actions',
          drawerItemStyle: { display: 'none' },
        }}
      />
      <Drawer.Screen 
        name="Summary" 
        component={SummaryScreen}
        options={{
          title: strings.sidebar.summarization,
          drawerItemStyle:  { display: 'none' },
        }}
      />
      <Drawer. Screen 
        name="Study" 
        component={StudyScreen}
        options={{
          title:  'Study',
          drawerItemStyle:  { display: 'none' },
        }}
      />
      <Drawer. Screen 
        name="Video" 
        component={VideoScreen}
        options={{
          title: strings.sidebar.aiVideo,
          drawerItemStyle: { display: 'none' },
        }}
      />
      <Drawer.Screen 
        name="Test" 
        component={TestScreen}
        options={{
          title: 'Test',
          drawerItemStyle:  { display: 'none' },
        }}
      />
      <Drawer. Screen 
        name="Labs" 
        component={LabsScreen}
        options={{
          title: strings.sidebar.labs,
        }}
      />
      <Drawer. Screen 
        name="Performance" 
        component={PerformanceScreen}
        options={{
          title: strings.sidebar.performance,
        }}
      />
      <Drawer. Screen 
        name="Exams" 
        component={ExamsScreen}
        options={{
          title: strings.sidebar.exams,
        }}
      />
      <Drawer.Screen 
        name="Interview" 
        component={InterviewScreen}
        options={{
          title: strings.sidebar. interviewTests,
        }}
      />
      {/* New Screens */}
      <Drawer.Screen 
        name="Flashcards" 
        component={FlashcardScreen}
        options={{
          title: 'Flashcards',
          drawerItemStyle: { display: 'none' },
        }}
      />
      <Drawer.Screen 
        name="Chat" 
        component={ChatScreen}
        options={{
          title: 'AI Chat',
          drawerItemStyle: { display: 'none' },
        }}
      />
      <Drawer.Screen 
        name="Achievements" 
        component={AchievementsScreen}
        options={{
          title: 'Achievements',
        }}
      />
      <Drawer.Screen 
        name="AudioPlayer" 
        component={AudioPlayerScreen}
        options={{
          title: 'Audio Player',
          drawerItemStyle: { display: 'none' },
        }}
      />
      <Drawer.Screen 
        name="Folders" 
        component={FoldersScreen}
        options={{
          title: 'My Folders',
        }}
      />
      <Drawer.Screen 
        name="Settings" 
        component={SettingsScreen}
        options={{
          title: 'Settings',
        }}
      />
    </Drawer.Navigator>
  );
};

export const AppNavigator = () => {
  return (
    <Stack.Navigator
      screenOptions={{
        headerShown: false,
      }}
    >
      <Stack.Screen name="Welcome" component={WelcomeScreen} />
      <Stack.Screen name="Auth" component={AuthScreen} />
      <Stack.Screen name="Main" component={MainDrawer} />
      <Stack.Screen 
        name="Paywall" 
        component={PaywallScreen}
        options={{
          presentation: 'modal',
        }}
      />
    </Stack.Navigator>
  );
};
