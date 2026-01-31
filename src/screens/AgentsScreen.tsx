import React, { useEffect, useState } from 'react';
import { View, Text, StyleSheet, FlatList, ActivityIndicator, RefreshControl } from 'react-native';
import { colors } from '../constants/colors';
import { Header } from '../components/Header';
import { Card } from '../components/Card';
import ApiService from '../services/apiService';

type Agent = { id: string; name: string; description?: string };

export const AgentsScreen: React.FC = () => {
  const [agents, setAgents] = useState<Agent[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isRefreshing, setIsRefreshing] = useState(false);

  const loadAgents = async () => {
    try {
      const list = await ApiService.listAgents();
      setAgents(Array.isArray(list) ? list : []);
    } catch {
      setAgents([]);
    }
  };

  useEffect(() => {
    (async () => {
      setIsLoading(true);
      await loadAgents();
      setIsLoading(false);
    })();
  }, []);

  const onRefresh = async () => {
    setIsRefreshing(true);
    await loadAgents();
    setIsRefreshing(false);
  };

  return (
    <View style={styles.container}>
      <Header title="Agents" subtitle="Available AI personas" />

      {isLoading ? (
        <View style={styles.loading}>
          <ActivityIndicator size="small" color={colors.primary} />
          <Text style={styles.loadingText}>Loading agents…</Text>
        </View>
      ) : (
        <FlatList
          data={agents}
          keyExtractor={(item) => item.id}
          contentContainerStyle={styles.listContent}
          refreshControl={<RefreshControl refreshing={isRefreshing} onRefresh={onRefresh} />}
          renderItem={({ item }) => (
            <Card title={item.name}>
              <Text style={styles.agentId}>ID: {item.id}</Text>
              {!!item.description && <Text style={styles.agentDesc}>{item.description}</Text>}
            </Card>
          )}
          ListEmptyComponent={
            <View style={styles.empty}>
              <Text style={styles.emptyTitle}>No agents found</Text>
              <Text style={styles.emptyText}>Pull to refresh.</Text>
            </View>
          }
        />
      )}
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.background,
  },
  loading: {
    padding: 16,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  loadingText: {
    color: colors.textLight,
    fontSize: 14,
  },
  listContent: {
    padding: 16,
    paddingBottom: 40,
  },
  agentId: {
    color: colors.textLight,
    fontSize: 12,
    marginBottom: 6,
  },
  agentDesc: {
    color: colors.text,
    fontSize: 14,
    lineHeight: 20,
  },
  empty: {
    paddingTop: 24,
    alignItems: 'center',
  },
  emptyTitle: {
    fontSize: 16,
    fontWeight: '600',
    color: colors.text,
  },
  emptyText: {
    marginTop: 6,
    fontSize: 13,
    color: colors.textLight,
  },
});

export default AgentsScreen;
