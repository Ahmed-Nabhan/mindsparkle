import React, { useState, useEffect } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  ScrollView,
  Modal,
  Alert,
} from 'react-native';
import * as DocumentPicker from 'expo-document-picker';
import { colors } from '../constants/colors';
import { useDocument } from '../hooks/useDocument';
import { Card } from './Card';
import { Button } from './Button';
import { LoadingSpinner } from './LoadingSpinner';
import type { Document } from '../types/document';

interface DocumentSelectorProps {
  onDocumentSelect: (document: Document) => void;
  title?: string;
  subtitle?: string;
}

export const DocumentSelector: React.FC<DocumentSelectorProps> = ({
  onDocumentSelect,
  title = 'Select a Document',
  subtitle = 'Choose from your library or upload a new document',
}) => {
  const { documents, isLoading, uploadDocument, refreshDocuments } = useDocument();
  const [isUploading, setIsUploading] = useState(false);
  const [showPicker, setShowPicker] = useState(false);

  useEffect(() => {
    refreshDocuments();
  }, []);

  const handlePickDocument = async () => {
    try {
      const result = await DocumentPicker.getDocumentAsync({
        type: ['application/pdf', 'text/plain', 'application/msword', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'],
        copyToCacheDirectory: true,
      });

      if (result.canceled || !result.assets || result.assets.length === 0) {
        return;
      }

      const file = result.assets[0];
      setIsUploading(true);
      setShowPicker(false);

      const uploadResult = await uploadDocument(
        file.name,
        file.uri,
        file.mimeType || 'application/pdf',
        file.size || 0
      );

      if (uploadResult.success && uploadResult.document) {
        Alert.alert('Success', 'Document uploaded successfully!');
        onDocumentSelect(uploadResult.document);
      } else {
        Alert.alert('Error', uploadResult.error || 'Failed to upload document');
      }
    } catch (error: any) {
      console.error('Error picking document:', error);
      Alert.alert('Error', 'Failed to pick document');
    } finally {
      setIsUploading(false);
    }
  };

  const handleSelectDocument = (document: Document) => {
    setShowPicker(false);
    onDocumentSelect(document);
  };

  const formatDate = (date: Date) => {
    return new Date(date).toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
    });
  };

  const formatFileSize = (bytes: number) => {
    if (bytes === 0) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
  };

  const getFileIcon = (fileType: string) => {
    if (fileType.includes('pdf')) return '📕';
    if (fileType.includes('word') || fileType.includes('document')) return '📘';
    if (fileType.includes('text')) return '📄';
    return '📁';
  };

  if (isUploading) {
    return <LoadingSpinner message="Uploading document..." />;
  }

  return (
    <View style={styles.container}>
      <Card>
        <Text style={styles.title}>{title}</Text>
        <Text style={styles.subtitle}>{subtitle}</Text>

        <View style={styles.buttonRow}>
          <TouchableOpacity
            style={styles.actionButton}
            onPress={() => setShowPicker(true)}
          >
            <Text style={styles.actionIcon}>📚</Text>
            <Text style={styles.actionText}>My Documents</Text>
            <Text style={styles.actionSubtext}>{documents.length} available</Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={styles.actionButton}
            onPress={handlePickDocument}
          >
            <Text style={styles.actionIcon}>📤</Text>
            <Text style={styles.actionText}>Upload New</Text>
            <Text style={styles.actionSubtext}>PDF, DOC, TXT</Text>
          </TouchableOpacity>
        </View>
      </Card>

      <Modal
        visible={showPicker}
        animationType="slide"
        presentationStyle="pageSheet"
        onRequestClose={() => setShowPicker(false)}
      >
        <View style={styles.modalContainer}>
          <View style={styles.modalHeader}>
            <Text style={styles.modalTitle}>Select Document</Text>
            <TouchableOpacity onPress={() => setShowPicker(false)}>
              <Text style={styles.closeButton}>✕</Text>
            </TouchableOpacity>
          </View>

          {isLoading ? (
            <LoadingSpinner message="Loading documents..." />
          ) : documents.length === 0 ? (
            <View style={styles.emptyState}>
              <Text style={styles.emptyIcon}>📭</Text>
              <Text style={styles.emptyText}>No documents yet</Text>
              <Text style={styles.emptySubtext}>
                Upload your first document to get started
              </Text>
              <Button
                title="Upload Document"
                onPress={handlePickDocument}
                style={styles.uploadButton}
              />
            </View>
          ) : (
            <ScrollView style={styles.documentList}>
              {documents.map((doc) => (
                <TouchableOpacity
                  key={doc.id}
                  style={styles.documentItem}
                  onPress={() => handleSelectDocument(doc)}
                >
                  <Text style={styles.documentIcon}>
                    {getFileIcon(doc.fileType)}
                  </Text>
                  <View style={styles.documentInfo}>
                    <Text style={styles.documentTitle} numberOfLines={1}>
                      {doc.title}
                    </Text>
                    <Text style={styles.documentMeta}>
                      {formatFileSize(doc.fileSize)} • {formatDate(doc.uploadedAt)}
                    </Text>
                  </View>
                  <Text style={styles.selectArrow}>→</Text>
                </TouchableOpacity>
              ))}

              <TouchableOpacity
                style={styles.uploadNewButton}
                onPress={handlePickDocument}
              >
                <Text style={styles.uploadNewIcon}>➕</Text>
                <Text style={styles.uploadNewText}>Upload New Document</Text>
              </TouchableOpacity>
            </ScrollView>
          )}
        </View>
      </Modal>
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  title: {
    fontSize: 24,
    fontWeight: 'bold',
    color: colors.text,
    textAlign: 'center',
    marginBottom: 8,
  },
  subtitle: {
    fontSize: 16,
    color: colors.textSecondary,
    textAlign: 'center',
    marginBottom: 24,
  },
  buttonRow: {
    flexDirection: 'row',
    justifyContent: 'space-around',
    gap: 16,
  },
  actionButton: {
    flex: 1,
    backgroundColor: colors.cardBackground,
    borderRadius: 16,
    padding: 20,
    alignItems: 'center',
    borderWidth: 2,
    borderColor: colors.border,
  },
  actionIcon: {
    fontSize: 40,
    marginBottom: 8,
  },
  actionText: {
    fontSize: 16,
    fontWeight: '600',
    color: colors.text,
    marginBottom: 4,
  },
  actionSubtext: {
    fontSize: 12,
    color: colors.textSecondary,
  },
  modalContainer: {
    flex: 1,
    backgroundColor: colors.background,
  },
  modalHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: 20,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  modalTitle: {
    fontSize: 20,
    fontWeight: 'bold',
    color: colors.text,
  },
  closeButton: {
    fontSize: 24,
    color: colors.textSecondary,
    padding: 8,
  },
  documentList: {
    flex: 1,
    padding: 16,
  },
  documentItem: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.cardBackground,
    borderRadius: 12,
    padding: 16,
    marginBottom: 12,
    borderWidth: 1,
    borderColor: colors.border,
  },
  documentIcon: {
    fontSize: 32,
    marginRight: 12,
  },
  documentInfo: {
    flex: 1,
  },
  documentTitle: {
    fontSize: 16,
    fontWeight: '600',
    color: colors.text,
    marginBottom: 4,
  },
  documentMeta: {
    fontSize: 12,
    color: colors.textSecondary,
  },
  selectArrow: {
    fontSize: 20,
    color: colors.primary,
    marginLeft: 8,
  },
  uploadNewButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.primary + '20',
    borderRadius: 12,
    padding: 16,
    marginTop: 8,
    borderWidth: 2,
    borderColor: colors.primary,
    borderStyle: 'dashed',
  },
  uploadNewIcon: {
    fontSize: 20,
    marginRight: 8,
  },
  uploadNewText: {
    fontSize: 16,
    fontWeight: '600',
    color: colors.primary,
  },
  emptyState: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: 40,
  },
  emptyIcon: {
    fontSize: 64,
    marginBottom: 16,
  },
  emptyText: {
    fontSize: 20,
    fontWeight: 'bold',
    color: colors.text,
    marginBottom: 8,
  },
  emptySubtext: {
    fontSize: 14,
    color: colors.textSecondary,
    textAlign: 'center',
    marginBottom: 24,
  },
  uploadButton: {
    minWidth: 200,
  },
});
