import React, { useState, useEffect } from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { useRoute } from '@react-navigation/native';
import { colors } from '../constants/colors';
import { Header } from '../components/Header';
import { LoadingSpinner } from '../components/LoadingSpinner';
import { useDocument } from '../hooks/useDocument';
import type { MainDrawerScreenProps } from '../navigation/types';
import type { Document } from '../types/document';

type LabsScreenProps = MainDrawerScreenProps<'Labs'>;

export const LabsScreen: React.FC = () => {
  const route = useRoute<LabsScreenProps['route']>();
  const { getDocument } = useDocument();
  const [document, setDocument] = useState<Document | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    loadDocument();
  }, []);

  const loadDocument = async () => {
    const doc = await getDocument(route.params.documentId);
    setDocument(doc);
    setIsLoading(false);
  };

  if (isLoading) {
    return <LoadingSpinner message="Loading labs..." />;
  }

  if (!document) {
    return (
      <View style={styles.container}>
        <Header title="Document Not Found" />
        <View style={styles.content}>
          <Text style={styles.errorText}>Document not found</Text>
        </View>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <Header title="Labs" subtitle={document.title} />
      
      <View style={styles.content}>
        <View style={styles.placeholder}>
          <Text style={styles.placeholderIcon}>🔬</Text>
          <Text style={styles.placeholderTitle}>Interactive Labs</Text>
          <Text style={styles.placeholderText}>
            External labs integration will be available here.
            Connect with coding environments, simulations, and practice platforms.
          </Text>
        </View>
      </View>
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.background,
  },
  content: {
    flex: 1,
  },
  placeholder: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: 32,
  },
  placeholderIcon: {
    fontSize: 64,
    marginBottom: 24,
  },
  placeholderTitle: {
    fontSize: 24,
    fontWeight: 'bold',
    color: colors.text,
    marginBottom: 16,
    textAlign: 'center',
  },
  placeholderText: {
    fontSize: 16,
    color: colors.textSecondary,
    textAlign: 'center',
    lineHeight: 24,
  },
  errorText: {
    fontSize: 16,
    color: colors.error,
    textAlign: 'center',
    marginTop: 32,
  },
});
