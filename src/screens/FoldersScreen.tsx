import React, { useState, useEffect } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  TextInput,
  Modal,
  FlatList,
  Alert,
} from 'react-native';
import { useNavigation, useRoute } from '@react-navigation/native';
import { colors } from '../constants/colors';
import folderService, { 
  Folder, 
  FOLDER_COLORS, 
  FOLDER_EMOJIS 
} from '../services/folderService';
import { usePremiumContext } from '../context/PremiumContext';
import type { MainDrawerScreenProps } from '../navigation/types';

type FoldersScreenProps = MainDrawerScreenProps<'Folders'>;

export const FoldersScreen: React.FC = () => {
  const navigation = useNavigation<FoldersScreenProps['navigation']>();
  const route = useRoute<FoldersScreenProps['route']>();
  const { isPremium, features, showPaywall } = usePremiumContext();

  // Optional route params for select mode
  const selectMode = route.params?.selectMode ?? false;
  const documentId = route.params?.documentId;
  const documentTitle = route.params?.documentTitle;

  const [folders, setFolders] = useState<Folder[]>([]);
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [newFolderName, setNewFolderName] = useState('');
  const [selectedEmoji, setSelectedEmoji] = useState('📁');
  const [selectedColor, setSelectedColor] = useState(FOLDER_COLORS[0]);
  const [editingFolder, setEditingFolder] = useState<Folder | null>(null);

  useEffect(() => {
    loadFolders();
  }, []);

  const loadFolders = async () => {
    const loadedFolders = await folderService.initialize();
    setFolders(loadedFolders);

    // Auto-suggest folder name if we're in select mode
    if (selectMode && documentTitle) {
      const suggested = folderService.suggestFolderName(documentTitle);
      setNewFolderName(suggested);
    }
  };

  const canCreateFolder = (): boolean => {
    if (isPremium) return true;
    if (!features.canCreateFolders) return false;
    if (features.maxFolders === -1) return true;
    return folders.length < features.maxFolders;
  };

  const handleCreateFolder = async () => {
    if (!newFolderName.trim()) {
      Alert.alert('Error', 'Please enter a folder name');
      return;
    }

    if (!canCreateFolder()) {
      showPaywall('Unlimited Folders');
      return;
    }

    const newFolder = await folderService.createFolder(
      newFolderName.trim(),
      selectedEmoji,
      selectedColor
    );

    setFolders(folderService.getAllFolders());
    setShowCreateModal(false);
    resetForm();

    // If in select mode, add document to the new folder
    if (selectMode && documentId) {
      await folderService.addDocumentToFolder(newFolder.id, documentId);
      navigation.goBack();
    }
  };

  const handleUpdateFolder = async () => {
    if (!editingFolder || !newFolderName.trim()) return;

    await folderService.updateFolder(editingFolder.id, {
      name: newFolderName.trim(),
      emoji: selectedEmoji,
      color: selectedColor,
    });

    setFolders(folderService.getAllFolders());
    setEditingFolder(null);
    setShowCreateModal(false);
    resetForm();
  };

  const handleDeleteFolder = async (folder: Folder) => {
    Alert.alert(
      'Delete Folder',
      `Are you sure you want to delete "${folder.name}"? Documents inside won't be deleted.`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete',
          style: 'destructive',
          onPress: async () => {
            await folderService.deleteFolder(folder.id);
            setFolders(folderService.getAllFolders());
          },
        },
      ]
    );
  };

  const handleSelectFolder = async (folder: Folder) => {
    if (selectMode && documentId) {
      await folderService.addDocumentToFolder(folder.id, documentId);
      navigation.goBack();
    } else {
      navigation.navigate('FolderDetail', { folderId: folder.id });
    }
  };

  const handleEditFolder = (folder: Folder) => {
    setEditingFolder(folder);
    setNewFolderName(folder.name);
    setSelectedEmoji(folder.emoji);
    setSelectedColor(folder.color);
    setShowCreateModal(true);
  };

  const resetForm = () => {
    setNewFolderName('');
    setSelectedEmoji('📁');
    setSelectedColor(FOLDER_COLORS[0]);
    setEditingFolder(null);
  };

  const renderFolder = ({ item }: { item: Folder }) => (
    <TouchableOpacity
      style={[styles.folderCard, { borderLeftColor: item.color }]}
      onPress={() => handleSelectFolder(item)}
      onLongPress={() => handleEditFolder(item)}
    >
      <View style={[styles.folderIcon, { backgroundColor: item.color + '20' }]}>
        <Text style={styles.folderEmoji}>{item.emoji}</Text>
      </View>
      <View style={styles.folderInfo}>
        <Text style={styles.folderName}>{item.name}</Text>
        <Text style={styles.folderCount}>
          {item.documentIds.length} document{item.documentIds.length !== 1 ? 's' : ''}
        </Text>
      </View>
      <TouchableOpacity
        style={styles.folderMenu}
        onPress={() => handleEditFolder(item)}
      >
        <Text style={styles.folderMenuIcon}>⋯</Text>
      </TouchableOpacity>
    </TouchableOpacity>
  );

  return (
    <View style={styles.container}>
      {/* Header */}
      <View style={styles.header}>
        <TouchableOpacity onPress={() => navigation.goBack()}>
          <Text style={styles.backButton}>← Back</Text>
        </TouchableOpacity>
        <Text style={styles.headerTitle}>
          {selectMode ? '📁 Select Folder' : '📁 Folders'}
        </Text>
        <View style={{ width: 60 }} />
      </View>

      {selectMode && documentTitle && (
        <View style={styles.selectBanner}>
          <Text style={styles.selectBannerText}>
            Choose a folder for "{documentTitle}"
          </Text>
        </View>
      )}

      {/* Folder List */}
      {folders.length > 0 ? (
        <FlatList
          data={folders}
          renderItem={renderFolder}
          keyExtractor={item => item.id}
          contentContainerStyle={styles.folderList}
          showsVerticalScrollIndicator={false}
        />
      ) : (
        <View style={styles.emptyState}>
          <Text style={styles.emptyEmoji}>📂</Text>
          <Text style={styles.emptyTitle}>No Folders Yet</Text>
          <Text style={styles.emptyText}>
            Create folders to organize your documents by subject or topic.
          </Text>
        </View>
      )}

      {/* Create Button */}
      <TouchableOpacity
        style={styles.createButton}
        onPress={() => {
          if (!canCreateFolder()) {
            showPaywall('Folders');
            return;
          }
          resetForm();
          setShowCreateModal(true);
        }}
      >
        <Text style={styles.createButtonText}>+ New Folder</Text>
      </TouchableOpacity>

      {/* Create/Edit Modal */}
      <Modal
        visible={showCreateModal}
        animationType="slide"
        transparent={true}
      >
        <View style={styles.modalOverlay}>
          <View style={styles.modalContent}>
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>
                {editingFolder ? 'Edit Folder' : 'Create Folder'}
              </Text>
              <TouchableOpacity
                onPress={() => {
                  setShowCreateModal(false);
                  resetForm();
                }}
              >
                <Text style={styles.modalClose}>✕</Text>
              </TouchableOpacity>
            </View>

            {/* Preview */}
            <View style={styles.previewContainer}>
              <View style={[styles.previewFolder, { backgroundColor: selectedColor + '20' }]}>
                <Text style={styles.previewEmoji}>{selectedEmoji}</Text>
              </View>
              <Text style={styles.previewName}>
                {newFolderName || 'Folder Name'}
              </Text>
            </View>

            {/* Name Input */}
            <TextInput
              style={styles.nameInput}
              placeholder="Enter folder name"
              placeholderTextColor={colors.textLight}
              value={newFolderName}
              onChangeText={setNewFolderName}
              autoFocus
            />

            {/* Emoji Picker */}
            <Text style={styles.pickerLabel}>Choose Icon</Text>
            <ScrollView horizontal showsHorizontalScrollIndicator={false}>
              <View style={styles.emojiPicker}>
                {FOLDER_EMOJIS.map((emoji) => (
                  <TouchableOpacity
                    key={emoji}
                    style={[
                      styles.emojiOption,
                      selectedEmoji === emoji && styles.emojiOptionSelected,
                    ]}
                    onPress={() => setSelectedEmoji(emoji)}
                  >
                    <Text style={styles.emojiText}>{emoji}</Text>
                  </TouchableOpacity>
                ))}
              </View>
            </ScrollView>

            {/* Color Picker */}
            <Text style={styles.pickerLabel}>Choose Color</Text>
            <View style={styles.colorPicker}>
              {FOLDER_COLORS.map((color) => (
                <TouchableOpacity
                  key={color}
                  style={[
                    styles.colorOption,
                    { backgroundColor: color },
                    selectedColor === color && styles.colorOptionSelected,
                  ]}
                  onPress={() => setSelectedColor(color)}
                >
                  {selectedColor === color && (
                    <Text style={styles.colorCheck}>✓</Text>
                  )}
                </TouchableOpacity>
              ))}
            </View>

            {/* Actions */}
            <View style={styles.modalActions}>
              {editingFolder && (
                <TouchableOpacity
                  style={styles.deleteButton}
                  onPress={() => {
                    setShowCreateModal(false);
                    handleDeleteFolder(editingFolder);
                  }}
                >
                  <Text style={styles.deleteButtonText}>Delete</Text>
                </TouchableOpacity>
              )}
              <TouchableOpacity
                style={styles.saveButton}
                onPress={editingFolder ? handleUpdateFolder : handleCreateFolder}
              >
                <Text style={styles.saveButtonText}>
                  {editingFolder ? 'Save Changes' : 'Create Folder'}
                </Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.background,
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 20,
    paddingTop: 60,
    paddingBottom: 20,
    backgroundColor: colors.primary,
  },
  backButton: {
    color: '#fff',
    fontSize: 18,
    fontWeight: '600',
  },
  headerTitle: {
    color: '#fff',
    fontSize: 20,
    fontWeight: 'bold',
  },
  selectBanner: {
    backgroundColor: colors.accent,
    padding: 12,
    alignItems: 'center',
  },
  selectBannerText: {
    color: '#fff',
    fontSize: 14,
    fontWeight: '600',
  },
  folderList: {
    padding: 20,
  },
  folderCard: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#fff',
    borderRadius: 12,
    padding: 16,
    marginBottom: 12,
    borderLeftWidth: 4,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.05,
    shadowRadius: 4,
    elevation: 2,
  },
  folderIcon: {
    width: 50,
    height: 50,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 14,
  },
  folderEmoji: {
    fontSize: 26,
  },
  folderInfo: {
    flex: 1,
  },
  folderName: {
    fontSize: 16,
    fontWeight: '600',
    color: colors.text,
    marginBottom: 2,
  },
  folderCount: {
    fontSize: 13,
    color: colors.textLight,
  },
  folderMenu: {
    padding: 8,
  },
  folderMenuIcon: {
    fontSize: 20,
    color: colors.textLight,
  },
  emptyState: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: 40,
  },
  emptyEmoji: {
    fontSize: 60,
    marginBottom: 20,
  },
  emptyTitle: {
    fontSize: 20,
    fontWeight: 'bold',
    color: colors.text,
    marginBottom: 10,
  },
  emptyText: {
    fontSize: 14,
    color: colors.textLight,
    textAlign: 'center',
    lineHeight: 22,
  },
  createButton: {
    position: 'absolute',
    bottom: 30,
    left: 20,
    right: 20,
    backgroundColor: colors.primary,
    borderRadius: 12,
    paddingVertical: 16,
    alignItems: 'center',
    shadowColor: colors.primary,
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 8,
    elevation: 5,
  },
  createButtonText: {
    color: '#fff',
    fontSize: 16,
    fontWeight: 'bold',
  },
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.5)',
    justifyContent: 'flex-end',
  },
  modalContent: {
    backgroundColor: '#fff',
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    padding: 24,
    maxHeight: '80%',
  },
  modalHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 20,
  },
  modalTitle: {
    fontSize: 20,
    fontWeight: 'bold',
    color: colors.text,
  },
  modalClose: {
    fontSize: 24,
    color: colors.textLight,
  },
  previewContainer: {
    alignItems: 'center',
    marginBottom: 24,
  },
  previewFolder: {
    width: 80,
    height: 80,
    borderRadius: 20,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 12,
  },
  previewEmoji: {
    fontSize: 40,
  },
  previewName: {
    fontSize: 18,
    fontWeight: '600',
    color: colors.text,
  },
  nameInput: {
    backgroundColor: colors.surface,
    borderRadius: 12,
    padding: 16,
    fontSize: 16,
    color: colors.text,
    marginBottom: 20,
    borderWidth: 1,
    borderColor: colors.border,
  },
  pickerLabel: {
    fontSize: 14,
    fontWeight: '600',
    color: colors.text,
    marginBottom: 12,
  },
  emojiPicker: {
    flexDirection: 'row',
    gap: 8,
    marginBottom: 20,
  },
  emojiOption: {
    width: 44,
    height: 44,
    borderRadius: 12,
    backgroundColor: colors.surface,
    alignItems: 'center',
    justifyContent: 'center',
  },
  emojiOptionSelected: {
    backgroundColor: colors.primary + '20',
    borderWidth: 2,
    borderColor: colors.primary,
  },
  emojiText: {
    fontSize: 24,
  },
  colorPicker: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 12,
    marginBottom: 24,
  },
  colorOption: {
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: 'center',
    justifyContent: 'center',
  },
  colorOptionSelected: {
    borderWidth: 3,
    borderColor: '#fff',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.3,
    shadowRadius: 4,
    elevation: 4,
  },
  colorCheck: {
    color: '#fff',
    fontSize: 18,
    fontWeight: 'bold',
  },
  modalActions: {
    flexDirection: 'row',
    gap: 12,
  },
  deleteButton: {
    flex: 1,
    backgroundColor: colors.error,
    borderRadius: 12,
    paddingVertical: 16,
    alignItems: 'center',
  },
  deleteButtonText: {
    color: '#fff',
    fontSize: 16,
    fontWeight: '600',
  },
  saveButton: {
    flex: 2,
    backgroundColor: colors.primary,
    borderRadius: 12,
    paddingVertical: 16,
    alignItems: 'center',
  },
  saveButtonText: {
    color: '#fff',
    fontSize: 16,
    fontWeight: 'bold',
  },
});

export default FoldersScreen;
