import type { StackScreenProps } from '@react-navigation/stack';
import type { DrawerScreenProps } from '@react-navigation/drawer';
import type { CompositeScreenProps } from '@react-navigation/native';

export type RootStackParamList = {
  Welcome: undefined;
  Main: undefined;
};

export type MainDrawerParamList = {
  Home: undefined;
  Upload: undefined;
  DocumentActions: { documentId: string };
  Summary: { documentId: string };
  Study: { documentId: string };
  Video: { documentId: string };
  Test: { documentId: string };
  Labs: { documentId: string };
  Performance: undefined;
  Exams: undefined;
  Interview: undefined;
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
