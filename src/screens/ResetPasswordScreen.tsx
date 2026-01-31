import React, { useMemo, useState } from 'react';
import { Alert, StyleSheet, Text, TextInput, View } from 'react-native';
import { colors } from '../constants/colors';
import { Button } from '../components/Button';
import { useAuth } from '../context/AuthContext';

export const ResetPasswordScreen: React.FC = () => {
  const { updatePassword } = useAuth();
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [isLoading, setIsLoading] = useState(false);

  const validation = useMemo(() => {
    if (!password) return { ok: false, message: 'Enter a new password.' };
    if (password.length < 6) return { ok: false, message: 'Password must be at least 6 characters.' };
    if (password !== confirmPassword) return { ok: false, message: 'Passwords do not match.' };
    return { ok: true, message: '' };
  }, [password, confirmPassword]);

  const handleSetPassword = async () => {
    if (!validation.ok) {
      Alert.alert('Error', validation.message);
      return;
    }

    try {
      setIsLoading(true);
      await updatePassword(password);
      Alert.alert('Password Updated', 'Your password has been updated. You can now sign in with your new password.');
      setPassword('');
      setConfirmPassword('');
    } catch (e: any) {
      Alert.alert('Reset Failed', e?.message || 'Could not update password. Please open the reset link again.');
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <View style={styles.container}>
      <View style={styles.card}>
        <Text style={styles.title}>Set New Password</Text>
        <Text style={styles.subtitle}>
          Enter a new password for your account.
        </Text>

        <View style={styles.inputContainer}>
          <Text style={styles.inputLabel}>New Password</Text>
          <TextInput
            style={styles.input}
            placeholder="••••••••"
            placeholderTextColor={colors.textLight}
            value={password}
            onChangeText={setPassword}
            secureTextEntry
            editable={!isLoading}
            autoCapitalize="none"
            autoCorrect={false}
          />
        </View>

        <View style={styles.inputContainer}>
          <Text style={styles.inputLabel}>Confirm Password</Text>
          <TextInput
            style={styles.input}
            placeholder="••••••••"
            placeholderTextColor={colors.textLight}
            value={confirmPassword}
            onChangeText={setConfirmPassword}
            secureTextEntry
            editable={!isLoading}
            autoCapitalize="none"
            autoCorrect={false}
          />
        </View>

        <Button
          title="Update Password"
          onPress={handleSetPassword}
          loading={isLoading}
          disabled={isLoading}
          style={styles.button}
        />

        {!validation.ok && Boolean(password || confirmPassword) ? (
          <Text style={styles.hint}>{validation.message}</Text>
        ) : null}
      </View>
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.background,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 20,
  },
  card: {
    width: '100%',
    maxWidth: 420,
    backgroundColor: colors.surface,
    borderRadius: 16,
    padding: 20,
    borderWidth: 1,
    borderColor: colors.border,
  },
  title: {
    fontSize: 22,
    fontWeight: '700',
    color: colors.text,
    marginBottom: 6,
  },
  subtitle: {
    fontSize: 14,
    color: colors.textSecondary,
    marginBottom: 18,
  },
  inputContainer: {
    marginBottom: 14,
  },
  inputLabel: {
    fontSize: 12,
    color: colors.textSecondary,
    marginBottom: 6,
  },
  input: {
    height: 48,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.background,
    paddingHorizontal: 12,
    color: colors.text,
  },
  button: {
    marginTop: 6,
  },
  hint: {
    marginTop: 10,
    color: colors.textSecondary,
    fontSize: 12,
  },
});
