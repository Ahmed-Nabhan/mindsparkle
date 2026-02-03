import React from 'react';
import { Platform } from 'react-native';
import { createStackNavigator } from '@react-navigation/stack';
import { createDrawerNavigator } from '@react-navigation/drawer';
import { Sidebar } from '../components/Sidebar';
import { colors } from '../constants/colors';
import { strings } from '../constants/strings';
import { useAuth } from '../context/AuthContext';
import { LoadingSpinner } from '../components/LoadingSpinner';

// Screens
import { HomeScreen } from '../screens/HomeScreen';
import { UploadScreen } from '../screens/UploadScreen';
import { DocumentActionsScreen } from '../screens/DocumentActionsScreen';
import { SummaryScreen } from '../screens/SummaryScreen';
import { DeepExplainScreen } from '../screens/DeepExplainScreen';
import { GuideScreen } from '../screens/GuideScreen';
import { WhiteboardScreen } from '../screens/WhiteboardScreen';
import PlanScreen from '../screens/PlanScreen';
import { VideoScreen } from '../screens/VideoScreen';
import { TestScreen } from '../screens/TestScreen';
import { LabsScreen } from '../screens/LabsScreen';
import { PerformanceScreen } from '../screens/PerformanceScreen';
import { ExamsScreen } from '../screens/ExamsScreen';
import { InterviewScreen } from '../screens/InterviewScreenText';

// New Screens
import { AuthScreen } from '../screens/AuthScreen';
import { PaywallScreen } from '../screens/PaywallScreen';
import { FlashcardScreen } from '../screens/FlashcardScreen';
import { ChatScreen } from '../screens/ChatScreen';
import { AudioPlayerScreen } from '../screens/AudioPlayerScreen';
import { AchievementsScreen } from '../screens/AchievementsScreen';
import { FoldersScreen } from '../screens/FoldersScreen';
import { SettingsScreen } from '../screens/SettingsScreen';
import { PresentationScreen } from '../screens/PresentationScreen';
import { ResetPasswordScreen } from '../screens/ResetPasswordScreen';
import { WelcomeScreen } from '../screens/WelcomeScreen';
import { AgentsScreen } from '../screens/AgentsScreen';

import type { RootStackParamList, MainDrawerParamList } from './types';

const Stack = createStackNavigator<RootStackParamList>();
const Drawer = createDrawerNavigator<MainDrawerParamList>();

const MainDrawer = () => {
  return (
    <Drawer.Navigator
      drawerContent={(props) => <Sidebar {...props} />}
      screenOptions={{
        headerShown: false,
        drawerActiveTintColor: colors.primary,
        drawerInactiveTintColor:  colors.textSecondary,
        drawerType: 'front',
        overlayColor: 'rgba(0,0,0,0.5)',
        swipeEnabled: true,
        swipeEdgeWidth: 30,
        drawerStyle: {
          width: 280,
        },
      }}
    >
      <Drawer.Screen 
        name="Home" 
        component={HomeScreen}
        options={{
          title: strings.home.title,
        }}
      />
      <Drawer.Screen 
        name="Upload" 
        component={UploadScreen}
        options={{
          title: strings.upload.title,
        }}
      />
      <Drawer.Screen
        name="Agents"
        component={AgentsScreen}
        options={{
          title: 'Agents',
          drawerItemStyle: { display: 'none' },
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
      <Drawer.Screen 
        name="DeepExplain" 
        component={DeepExplainScreen}
        options={{
          title: 'Deep Explain',
          drawerItemStyle:  { display: 'none' },
        }}
      />
      <Drawer.Screen
        name="Guide"
        component={GuideScreen}
        options={{
          title: 'Guide',
          drawerItemStyle: { display: 'none' },
        }}
      />

      <Drawer.Screen
        name="Whiteboard"
        component={WhiteboardScreen}
        options={{
          title: 'Whiteboard',
          drawerItemStyle: { display: 'none' },
        }}
      />

      <Drawer.Screen
        name="Plan"
        component={PlanScreen}
        options={{
          title: 'Plan',
          drawerItemStyle: { display: 'none' },
        }}
      />
      <Drawer.Screen 
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
      <Drawer.Screen 
        name="Labs" 
        component={LabsScreen}
        options={{
          title: strings.sidebar.labs,
        }}
      />
      <Drawer.Screen 
        name="Performance" 
        component={PerformanceScreen}
        options={{
          title: strings.sidebar.performance,
        }}
      />
      <Drawer.Screen 
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
          title: strings.sidebar.interviewTests,
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
        name="ChatMind" 
        component={ChatScreen}
        options={{
          title: 'Chat Mind',
        }}
      />
      <Drawer.Screen
        name="DocChat"
        component={ChatScreen}
        options={{
          title: 'AI Chat (Doc)',
          drawerItemStyle: { display: 'none' },
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
        name="Achievements" 
        component={AchievementsScreen}
        options={{
          title: 'Achievements',
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
      <Drawer.Screen 
        name="Presentation" 
        component={PresentationScreen}
        options={{
          title: 'AI Presentation',
          // Presentation should be accessed from Document Actions (not from the sidebar)
          drawerItemStyle: { display: 'none' },
        }}
      />
    </Drawer.Navigator>
  );
};

export const AppNavigator = () => {
  const { isAuthenticated, isLoading } = useAuth();
  const isWeb = Platform.OS === 'web';

  if (isLoading) {
    return <LoadingSpinner message="Loading…" />;
  }

  return (
    <Stack.Navigator
      screenOptions={{
        headerShown: false,
      }}
      initialRouteName={isWeb ? 'Main' : 'Welcome'}
    >
      {!isWeb && <Stack.Screen name="Welcome" component={WelcomeScreen} />}
      <Stack.Screen name="Main" component={MainDrawer} />
      <Stack.Screen name="Auth" component={AuthScreen} />
      <Stack.Screen name="ResetPassword" component={ResetPasswordScreen} />
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
