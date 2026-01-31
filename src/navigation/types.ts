import type { StackScreenProps } from '@react-navigation/stack';
import type { DrawerScreenProps } from '@react-navigation/drawer';
import type { CompositeScreenProps } from '@react-navigation/native';
import type { Document } from '../types/document';
import type { Flashcard } from '../services/flashcardService';

export type RootStackParamList = {
  Welcome: undefined;
  Auth: { mode?: 'signin' | 'signup' };
  ResetPassword: undefined;
  Main: undefined;
  Paywall: { source?: string };
};

export type MainDrawerParamList = {
  Home: undefined;
  Upload: undefined;
  Agents: undefined;
  DocumentActions: { documentId: string };
  Summary: { documentId: string };
  DeepExplain: { documentId: string; initialPageIndex?: number };
  AudioPlayer: {
    content: string;
    title?: string;
    documentId?: string;
  };
  Guide: { documentId: string };
  Whiteboard: { documentId: string };
  Plan: { documentId: string };
  Video: { 
    documentId: string;
    content?: string;
    fileUri?: string;
    pdfCloudUrl?: string;
    extractedData?: any;
  };
  Test: { documentId?: string; focusTopics?: string[] } | undefined;
  Labs: { documentId: string };
  Performance: undefined;
  Exams: undefined;
  Interview: undefined;
  // New screens
  Flashcards: { 
    documentId: string;
    flashcards?: Flashcard[];
    documentTitle?: string;
  };
  ChatMind: undefined;
  DocChat: {
    documentId: string;
    documentContent?: string;
    documentTitle?: string;
    agentId?: string;
    agentName?: string;
  };
  Achievements: undefined;
  Folders: {
    selectMode?: boolean;
    documentId?: string;
    documentTitle?: string;
  } | undefined;
  FolderDetail: {
    folderId: string;
  };
  Settings: undefined;
  Presentation: { documentId?: string } | undefined;
};

export type RootStackScreenProps<T extends keyof RootStackParamList> = 
  StackScreenProps<RootStackParamList, T>;

export type MainDrawerScreenProps<T extends keyof MainDrawerParamList> = 
  CompositeScreenProps<
    DrawerScreenProps<MainDrawerParamList, T>,
    RootStackScreenProps<keyof RootStackParamList>
  >;

declare global {
  namespace ReactNavigation {
    interface RootParamList extends RootStackParamList {}
  }
}
