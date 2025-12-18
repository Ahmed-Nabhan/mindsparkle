import React from 'react';
import { NavigationContainer } from '@react-navigation/native';
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

import type { RootStackParamList, MainDrawerParamList } from './types';

const Stack = createStackNavigator<RootStackParamList>();
const Drawer = createDrawerNavigator<MainDrawerParamList>();

const MainDrawer = () => {
  return (
    <Drawer.Navigator
      drawerContent={(props) => <Sidebar {...props} />}
      screenOptions={{
        headerStyle: {
          backgroundColor: colors.primary,
        },
        headerTintColor: '#FFFFFF',
        headerTitleStyle: {
          fontWeight: 'bold',
        },
        drawerActiveTintColor: colors.primary,
        drawerInactiveTintColor: colors.textSecondary,
      }}
    >
      <Drawer.Screen 
        name="Home" 
        component={HomeScreen}
        options={{
          title: strings.home.title,
          drawerIcon: () => '🏠',
        }}
      />
      <Drawer.Screen 
        name="Upload" 
        component={UploadScreen}
        options={{
          title: strings.upload.title,
          drawerIcon: () => '📄',
        }}
      />
      <Drawer.Screen 
        name="DocumentActions" 
        component={DocumentActionsScreen}
        options={{
          title: 'Document Actions',
          drawerItemStyle: { display: 'none' },
        }}
      />
      <Drawer.Screen 
        name="Summary" 
        component={SummaryScreen}
        options={{
          title: strings.sidebar.summarization,
          drawerItemStyle: { display: 'none' },
        }}
      />
      <Drawer.Screen 
        name="Study" 
        component={StudyScreen}
        options={{
          title: 'Study',
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
          drawerItemStyle: { display: 'none' },
        }}
      />
      <Drawer.Screen 
        name="Labs" 
        component={LabsScreen}
        options={{
          title: strings.sidebar.labs,
          drawerIcon: () => '🔬',
        }}
      />
      <Drawer.Screen 
        name="Performance" 
        component={PerformanceScreen}
        options={{
          title: strings.sidebar.performance,
          drawerIcon: () => '📊',
        }}
      />
      <Drawer.Screen 
        name="Exams" 
        component={ExamsScreen}
        options={{
          title: strings.sidebar.exams,
          drawerIcon: () => '📋',
        }}
      />
      <Drawer.Screen 
        name="Interview" 
        component={InterviewScreen}
        options={{
          title: strings.sidebar.interviewTests,
          drawerIcon: () => '💼',
        }}
      />
    </Drawer.Navigator>
  );
};

export const AppNavigator = () => {
  return (
    <NavigationContainer>
      <Stack.Navigator
        screenOptions={{
          headerShown: false,
        }}
      >
        <Stack.Screen name="Welcome" component={WelcomeScreen} />
        <Stack.Screen name="Main" component={MainDrawer} />
      </Stack.Navigator>
    </NavigationContainer>
  );
};
