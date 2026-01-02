/**
 * VendorBadge Component
 * 
 * Displays vendor logo and name when vendor-specific content is detected
 * Used across all mode screens (Study, Quiz, Interview, Labs, Video)
 */

import React from 'react';
import { View, Text, StyleSheet, TouchableOpacity, Image } from 'react-native';
import { colors } from '../constants/colors';

// Vendor logo URLs (CDN-hosted for reliability)
// These can be replaced with local assets: require('../../assets/images/vendor-logo.png')
const VENDOR_LOGO_URLS: Record<string, string> = {
  cisco: 'https://upload.wikimedia.org/wikipedia/commons/thumb/0/08/Cisco_logo_blue_2016.svg/200px-Cisco_logo_blue_2016.svg.png',
  aws: 'https://upload.wikimedia.org/wikipedia/commons/thumb/9/93/Amazon_Web_Services_Logo.svg/200px-Amazon_Web_Services_Logo.svg.png',
  microsoft: 'https://upload.wikimedia.org/wikipedia/commons/thumb/4/44/Microsoft_logo.svg/200px-Microsoft_logo.svg.png',
  google: 'https://upload.wikimedia.org/wikipedia/commons/thumb/2/2f/Google_2015_logo.svg/200px-Google_2015_logo.svg.png',
  comptia: 'https://upload.wikimedia.org/wikipedia/commons/thumb/8/8c/CompTIA_logo.svg/200px-CompTIA_logo.svg.png',
  vmware: 'https://upload.wikimedia.org/wikipedia/commons/thumb/9/9a/Vmware.svg/200px-Vmware.svg.png',
  redhat: 'https://upload.wikimedia.org/wikipedia/commons/thumb/d/d8/Red_Hat_logo.svg/200px-Red_Hat_logo.svg.png',
  fortinet: 'https://upload.wikimedia.org/wikipedia/commons/thumb/6/62/Fortinet_logo.svg/200px-Fortinet_logo.svg.png',
  juniper: 'https://upload.wikimedia.org/wikipedia/commons/thumb/3/31/Juniper_Networks_logo.svg/200px-Juniper_Networks_logo.svg.png',
  oracle: 'https://upload.wikimedia.org/wikipedia/commons/thumb/5/50/Oracle_logo.svg/200px-Oracle_logo.svg.png',
};

// Vendor emoji fallbacks when images fail to load
const VENDOR_EMOJIS: Record<string, string> = {
  cisco: '🌐',
  aws: '☁️',
  microsoft: '🪟',
  google: '🔍',
  comptia: '📜',
  vmware: '🖥️',
  redhat: '🎩',
  fortinet: '🛡️',
  paloalto: '🔥',
  juniper: '🌿',
  oracle: '🔮',
  generic: '📄',
};

// Vendor colors for styling
const VENDOR_COLORS: Record<string, { primary: string; secondary: string; text: string }> = {
  cisco: { primary: '#049FD9', secondary: '#E6F6FC', text: '#049FD9' },
  aws: { primary: '#FF9900', secondary: '#FFF4E6', text: '#232F3E' },
  microsoft: { primary: '#00A4EF', secondary: '#E6F5FF', text: '#00A4EF' },
  google: { primary: '#4285F4', secondary: '#E6F1FF', text: '#4285F4' },
  comptia: { primary: '#C8202F', secondary: '#FCE8EA', text: '#C8202F' },
  vmware: { primary: '#696566', secondary: '#F0F0F0', text: '#696566' },
  redhat: { primary: '#EE0000', secondary: '#FFE6E6', text: '#EE0000' },
  fortinet: { primary: '#EE3124', secondary: '#FCE8E7', text: '#EE3124' },
  paloalto: { primary: '#FA582D', secondary: '#FFECE8', text: '#FA582D' },
  juniper: { primary: '#009639', secondary: '#E6F5EB', text: '#009639' },
  oracle: { primary: '#F80000', secondary: '#FFE6E6', text: '#F80000' },
  generic: { primary: '#6B7280', secondary: '#F3F4F6', text: '#6B7280' },
};

export interface VendorInfo {
  vendorId: string;
  vendorName: string;
  confidence: number;
  detected: boolean;
  certificationMatch?: string;
  certificationLevel?: string;
}

interface VendorBadgeProps {
  vendor: VendorInfo;
  size?: 'small' | 'medium' | 'large';
  showConfidence?: boolean;
  showCertification?: boolean;
  onPress?: () => void;
  style?: any;
}

export const VendorBadge: React.FC<VendorBadgeProps> = ({
  vendor,
  size = 'medium',
  showConfidence = false,
  showCertification = true,
  onPress,
  style,
}) => {
  const [imageError, setImageError] = React.useState(false);

  if (!vendor.detected) {
    return null;
  }

  const vendorColor = VENDOR_COLORS[vendor.vendorId] || VENDOR_COLORS.generic;
  const logoUrl = VENDOR_LOGO_URLS[vendor.vendorId];
  const emoji = VENDOR_EMOJIS[vendor.vendorId] || VENDOR_EMOJIS.generic;

  const sizeStyles = {
    small: { badge: styles.badgeSmall, logo: styles.logoSmall, text: styles.textSmall, emoji: 16 },
    medium: { badge: styles.badgeMedium, logo: styles.logoMedium, text: styles.textMedium, emoji: 22 },
    large: { badge: styles.badgeLarge, logo: styles.logoLarge, text: styles.textLarge, emoji: 28 },
  };

  const currentSize = sizeStyles[size];

  const content = (
    <View
      style={[
        styles.badge,
        currentSize.badge,
        { backgroundColor: vendorColor.secondary, borderColor: vendorColor.primary },
        style,
      ]}
    >
      {logoUrl && !imageError ? (
        <Image
          source={{ uri: logoUrl }}
          style={[styles.logo, currentSize.logo]}
          resizeMode="contain"
          onError={() => setImageError(true)}
        />
      ) : (
        <Text style={{ fontSize: currentSize.emoji, marginRight: 8 }}>{emoji}</Text>
      )}
      <View style={styles.textContainer}>
        <Text style={[styles.vendorName, currentSize.text, { color: vendorColor.text }]}>
          {vendor.vendorName}
        </Text>
        {showCertification && vendor.certificationMatch && (
          <Text style={[styles.certification, { color: vendorColor.text }]} numberOfLines={1}>
            {vendor.certificationMatch}
            {vendor.certificationLevel && ` (${vendor.certificationLevel})`}
          </Text>
        )}
        {showConfidence && (
          <Text style={[styles.confidence, { color: vendorColor.text }]}>
            {Math.round(vendor.confidence * 100)}% match
          </Text>
        )}
      </View>
    </View>
  );

  if (onPress) {
    return <TouchableOpacity onPress={onPress}>{content}</TouchableOpacity>;
  }

  return content;
};

/**
 * VendorBanner - Full-width banner for top of screen
 */
interface VendorBannerProps {
  vendor: VendorInfo;
  style?: any;
}

export const VendorBanner: React.FC<VendorBannerProps> = ({ vendor, style }) => {
  const [imageError, setImageError] = React.useState(false);

  if (!vendor.detected) {
    return null;
  }

  const vendorColor = VENDOR_COLORS[vendor.vendorId] || VENDOR_COLORS.generic;
  const logoUrl = VENDOR_LOGO_URLS[vendor.vendorId];
  const emoji = VENDOR_EMOJIS[vendor.vendorId] || VENDOR_EMOJIS.generic;

  return (
    <View style={[styles.banner, { backgroundColor: vendorColor.secondary }, style]}>
      {logoUrl && !imageError ? (
        <Image
          source={{ uri: logoUrl }}
          style={styles.bannerLogo}
          resizeMode="contain"
          onError={() => setImageError(true)}
        />
      ) : (
        <Text style={{ fontSize: 32, marginRight: 12 }}>{emoji}</Text>
      )}
      <View style={styles.bannerTextContainer}>
        <Text style={[styles.bannerTitle, { color: vendorColor.text }]}>
          {vendor.vendorName} Content Detected
        </Text>
        {vendor.certificationMatch && (
          <Text style={[styles.bannerSubtitle, { color: vendorColor.text }]}>
            {vendor.certificationMatch}
          </Text>
        )}
      </View>
      <View style={[styles.confidenceIndicator, { backgroundColor: vendorColor.primary }]}>
        <Text style={styles.confidenceText}>{Math.round(vendor.confidence * 100)}%</Text>
      </View>
    </View>
  );
};

/**
 * VendorPill - Compact inline vendor indicator
 */
interface VendorPillProps {
  vendor: VendorInfo;
  style?: any;
}

export const VendorPill: React.FC<VendorPillProps> = ({ vendor, style }) => {
  if (!vendor.detected) {
    return null;
  }

  const vendorColor = VENDOR_COLORS[vendor.vendorId] || VENDOR_COLORS.generic;

  return (
    <View style={[styles.pill, { backgroundColor: vendorColor.primary }, style]}>
      <Text style={styles.pillText}>{vendor.vendorName}</Text>
    </View>
  );
};

/**
 * VendorInfoCard - Detailed vendor information card
 */
interface VendorInfoCardProps {
  vendor: VendorInfo;
  documentTitle?: string;
  onLearnMore?: () => void;
  style?: any;
}

export const VendorInfoCard: React.FC<VendorInfoCardProps> = ({
  vendor,
  documentTitle,
  onLearnMore,
  style,
}) => {
  const [imageError, setImageError] = React.useState(false);

  if (!vendor.detected) {
    return null;
  }

  const vendorColor = VENDOR_COLORS[vendor.vendorId] || VENDOR_COLORS.generic;
  const logoUrl = VENDOR_LOGO_URLS[vendor.vendorId];
  const emoji = VENDOR_EMOJIS[vendor.vendorId] || VENDOR_EMOJIS.generic;

  const getVendorDescription = (vendorId: string): string => {
    const descriptions: Record<string, string> = {
      cisco: 'Network infrastructure and cybersecurity leader',
      aws: 'Cloud computing and web services platform',
      microsoft: 'Cloud, productivity, and enterprise solutions',
      google: 'Cloud platform and developer services',
      comptia: 'IT industry certifications and standards',
      vmware: 'Virtualization and cloud infrastructure',
      redhat: 'Open-source enterprise solutions',
      fortinet: 'Network security and firewall solutions',
      paloalto: 'Next-generation security platform',
      juniper: 'Network automation and security',
      oracle: 'Database and enterprise software solutions',
    };
    return descriptions[vendorId] || 'Technology provider';
  };

  return (
    <View style={[styles.infoCard, { borderColor: vendorColor.primary }, style]}>
      <View style={styles.infoCardHeader}>
        {logoUrl && !imageError ? (
          <Image
            source={{ uri: logoUrl }}
            style={styles.infoCardLogo}
            resizeMode="contain"
            onError={() => setImageError(true)}
          />
        ) : (
          <Text style={{ fontSize: 40, marginRight: 12 }}>{emoji}</Text>
        )}
        <View style={styles.infoCardTitleContainer}>
          <Text style={[styles.infoCardTitle, { color: vendorColor.text }]}>
            {vendor.vendorName}
          </Text>
          <Text style={styles.infoCardDescription}>
            {getVendorDescription(vendor.vendorId)}
          </Text>
        </View>
      </View>

      <View style={styles.infoCardBody}>
        {vendor.certificationMatch && (
          <View style={styles.infoRow}>
            <Text style={styles.infoLabel}>Certification:</Text>
            <Text style={styles.infoValue}>{vendor.certificationMatch}</Text>
          </View>
        )}
        {vendor.certificationLevel && (
          <View style={styles.infoRow}>
            <Text style={styles.infoLabel}>Level:</Text>
            <Text style={styles.infoValue}>{vendor.certificationLevel}</Text>
          </View>
        )}
        <View style={styles.infoRow}>
          <Text style={styles.infoLabel}>Confidence:</Text>
          <View style={styles.confidenceBar}>
            <View
              style={[
                styles.confidenceProgress,
                { width: `${vendor.confidence * 100}%`, backgroundColor: vendorColor.primary },
              ]}
            />
          </View>
          <Text style={styles.infoValue}>{Math.round(vendor.confidence * 100)}%</Text>
        </View>
      </View>

      {onLearnMore && (
        <TouchableOpacity
          style={[styles.learnMoreButton, { backgroundColor: vendorColor.primary }]}
          onPress={onLearnMore}
        >
          <Text style={styles.learnMoreText}>Learn More</Text>
        </TouchableOpacity>
      )}
    </View>
  );
};

const styles = StyleSheet.create({
  // Badge styles
  badge: {
    flexDirection: 'row',
    alignItems: 'center',
    borderWidth: 1,
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  badgeSmall: {
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 6,
  },
  badgeMedium: {
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 8,
  },
  badgeLarge: {
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderRadius: 10,
  },
  logo: {
    marginRight: 8,
  },
  logoSmall: {
    width: 20,
    height: 20,
  },
  logoMedium: {
    width: 28,
    height: 28,
  },
  logoLarge: {
    width: 36,
    height: 36,
  },
  textContainer: {
    flex: 1,
  },
  vendorName: {
    fontWeight: '600',
  },
  textSmall: {
    fontSize: 12,
  },
  textMedium: {
    fontSize: 14,
  },
  textLarge: {
    fontSize: 16,
  },
  certification: {
    fontSize: 11,
    marginTop: 2,
    opacity: 0.8,
  },
  confidence: {
    fontSize: 10,
    marginTop: 2,
    opacity: 0.6,
  },

  // Banner styles
  banner: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 12,
    borderRadius: 12,
    marginBottom: 16,
  },
  bannerLogo: {
    width: 40,
    height: 40,
    marginRight: 12,
  },
  bannerTextContainer: {
    flex: 1,
  },
  bannerTitle: {
    fontSize: 16,
    fontWeight: '600',
  },
  bannerSubtitle: {
    fontSize: 13,
    marginTop: 2,
    opacity: 0.8,
  },
  confidenceIndicator: {
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 12,
  },
  confidenceText: {
    color: '#FFFFFF',
    fontSize: 12,
    fontWeight: '600',
  },

  // Pill styles
  pill: {
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 12,
  },
  pillText: {
    color: '#FFFFFF',
    fontSize: 11,
    fontWeight: '600',
  },

  // Info Card styles
  infoCard: {
    backgroundColor: '#FFFFFF',
    borderWidth: 2,
    borderRadius: 16,
    padding: 16,
    marginBottom: 16,
  },
  infoCardHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 16,
    paddingBottom: 16,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  infoCardLogo: {
    width: 48,
    height: 48,
    marginRight: 12,
  },
  infoCardTitleContainer: {
    flex: 1,
  },
  infoCardTitle: {
    fontSize: 18,
    fontWeight: '700',
  },
  infoCardDescription: {
    fontSize: 13,
    color: colors.textSecondary,
    marginTop: 2,
  },
  infoCardBody: {
    marginBottom: 12,
  },
  infoRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 8,
  },
  infoLabel: {
    width: 100,
    fontSize: 13,
    color: colors.textSecondary,
  },
  infoValue: {
    fontSize: 14,
    fontWeight: '500',
    color: colors.text,
  },
  confidenceBar: {
    flex: 1,
    height: 6,
    backgroundColor: colors.border,
    borderRadius: 3,
    marginRight: 8,
    overflow: 'hidden',
  },
  confidenceProgress: {
    height: '100%',
    borderRadius: 3,
  },
  learnMoreButton: {
    alignItems: 'center',
    paddingVertical: 10,
    borderRadius: 8,
    marginTop: 8,
  },
  learnMoreText: {
    color: '#FFFFFF',
    fontSize: 14,
    fontWeight: '600',
  },
});

export default VendorBadge;
