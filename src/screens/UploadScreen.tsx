import React, { useState, useEffect } from 'react';
import { View, Text, StyleSheet, FlatList, TouchableOpacity, Alert } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { colors } from '../constants/colors';
import { strings } from '../constants/strings';
import { Header } from '../components/Header';
import { Card } from '../components/Card';
import { DocumentUploader } from '../components/DocumentUploader';
import { LoadingSpinner } from '../components/LoadingSpinner';
import { useDocument } from '../hooks/useDocument';
import { formatDate, formatFileSize } from '../utils/helpers';
import type { MainDrawerScreenProps } from '../navigation/types';
import type { Document } from '../types/document';

type UploadScreenProps = MainDrawerScreenProps<'Upload'>;

export const UploadScreen: React.FC = () => {
  const navigation = useNavigation<UploadScreenProps['navigation']>();
  const { documents, uploadDocument, isLoading } = useDocument();

  const handleDocumentSelected = async (result: any) => {
    if (result.canceled || !result.assets || result.assets.length === 0) return;

    const file = result.assets[0];
    const uploadResult = await uploadDocument(
      file.name,
      file.uri,
      file.mimeType || 'application/octet-stream',
      file.size || 0
    );

    if (uploadResult.success) {
      Alert.alert('Success', 'Document uploaded successfully!');
    } else {
      Alert.alert('Error', uploadResult.error || 'Failed to upload document');
    }
  };

  const handleDocumentPress = (document: Document) => {
    navigation.navigate('DocumentActions', { documentId: document.id });
  };

  const renderDocument = ({ item }: { item: Document }) => (
    <Card onPress={() => handleDocumentPress(item)}>
      <View>
        <Text style={styles.documentTitle}>{item.title}</Text>
        <View style={styles.documentMeta}>
          <Text style={styles.metaText}>{formatDate(item.uploadedAt)}</Text>
          <Text style={styles.metaText}>{formatFileSize(item.fileSize)}</Text>
        </View>
      </View>
    </Card>
  );

  if (isLoading && documents.length === 0) {
    return <LoadingSpinner message="Loading documents..." />;
  }

  return (
    <View style={styles.container}>
      <Header title={strings.upload.title} />
      
      <View style={styles.content}>
        <DocumentUploader onDocumentSelected={handleDocumentSelected} />

        <View style={styles.listContainer}>
          <Text style={styles.sectionTitle}>My Documents</Text>
          {documents.length === 0 ? (
            <Text style={styles.noDocuments}>{strings.upload.noDocuments}</Text>
          ) : (
            <FlatList
              data={documents}
              renderItem={renderDocument}
              keyExtractor={item => item.id}
              contentContainerStyle={styles.list}
            />
          )}
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
  listContainer: {
    flex: 1,
    padding: 16,
  },
  sectionTitle: {
    fontSize: 20,
    fontWeight: 'bold',
    color: colors.text,
    marginBottom: 16,
  },
  noDocuments: {
    fontSize: 14,
    color: colors.textSecondary,
    textAlign: 'center',
    marginTop: 32,
  },
  list: {
    paddingBottom: 16,
  },
  documentTitle: {
    fontSize: 16,
    fontWeight: '600',
    color: colors.text,
    marginBottom: 8,
  },
  documentMeta: {
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  metaText: {
    fontSize: 12,
    color: colors.textSecondary,
  },
});
