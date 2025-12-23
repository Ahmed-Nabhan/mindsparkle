import React, { useState } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, Alert, ActivityIndicator } from 'react-native';
import * as DocumentPicker from 'expo-document-picker';
import { colors } from '../constants/colors';
import { strings } from '../constants/strings';
import { config } from '../constants/config';
import { isValidFileType, isValidFileSize } from '../utils/validators';
import { formatFileSize } from '../utils/helpers';

interface DocumentUploaderProps {
  onDocumentSelected: (document: DocumentPicker. DocumentPickerResult) => void;
}

export const DocumentUploader: React.FC<DocumentUploaderProps> = ({
  onDocumentSelected,
}) => {
  const [selectedFile, setSelectedFile] = useState<DocumentPicker.DocumentPickerAsset | null>(null);
  const [isPicking, setIsPicking] = useState(false);

  const pickDocument = async () => {
    // Prevent double-tap
    if (isPicking) return;
    
    setIsPicking(true);
    
    try {
      const result = await DocumentPicker.getDocumentAsync({
        type: ['application/pdf', 'application/msword', 'application/vnd. openxmlformats-officedocument.wordprocessingml.document', 'text/plain'],
        copyToCacheDirectory: true,
      });

      if (!result.canceled && result.assets && result.assets.length > 0) {
        const file = result.assets[0];
        
        // Validate file type
        if (!isValidFileType(file. name, config.supportedFileTypes.documents)) {
          Alert.alert('Invalid File', 'Please select a PDF, DOC, DOCX, or TXT file.');
          setIsPicking(false);
          return;
        }

        // Validate file size
        if (file.size && !isValidFileSize(file.size, config.limits. maxDocumentSize)) {
          Alert. alert(
            'File Too Large',
            `Maximum file size is ${formatFileSize(config.limits. maxDocumentSize)}.`
          );
          setIsPicking(false);
          return;
        }

        setSelectedFile(file);
        onDocumentSelected(result);
      }
    } catch (error) {
      console.error('Error picking document:', error);
      Alert.alert('Error', 'Failed to pick document. Please try again.');
    } finally {
      setIsPicking(false);
    }
  };

  return (
    <View style={styles.container}>
      <TouchableOpacity 
        style={[styles.uploadBox, isPicking && styles.uploadBoxDisabled]} 
        onPress={pickDocument}
        disabled={isPicking}
      >
        {isPicking ? (
          <ActivityIndicator size="large" color={colors.primary} />
        ) : (
          <>
            <Text style={styles.uploadIcon}>📄</Text>
            <Text style={styles.uploadText}>{strings. upload.selectFile}</Text>
            <Text style={styles. supportedFormats}>{strings.upload. supportedFormats}</Text>
          </>
        )}
      </TouchableOpacity>

      {selectedFile && (
        <View style={styles.selectedFile}>
          <Text style={styles.fileName}>{selectedFile.name}</Text>
          <Text style={styles.fileSize}>
            {selectedFile. size ? formatFileSize(selectedFile.size) : 'Unknown size'}
          </Text>
        </View>
      )}
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    padding: 16,
  },
  uploadBox: {
    borderWidth:  2,
    borderColor: colors. primary,
    borderStyle: 'dashed',
    borderRadius: 12,
    padding: 32,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor:  colors.cardBackground,
  },
  uploadBoxDisabled: {
    opacity: 0.6,
  },
  uploadIcon: {
    fontSize: 48,
    marginBottom: 16,
  },
  uploadText:  {
    fontSize:  16,
    fontWeight: '600',
    color:  colors.primary,
    marginBottom: 8,
  },
  supportedFormats: {
    fontSize: 12,
    color: colors.textSecondary,
  },
  selectedFile: {
    marginTop:  16,
    padding: 12,
    backgroundColor: colors.success + '20',
    borderRadius: 8,
    borderWidth: 1,
    borderColor: colors.success,
  },
  fileName: {
    fontSize: 14,
    fontWeight: '600',
    color: colors. text,
    marginBottom: 4,
  },
  fileSize: {
    fontSize: 12,
    color:  colors.textSecondary,
  },
});
