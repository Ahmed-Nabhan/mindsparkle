type TrackingPermissionStatus = 'granted' | 'denied' | 'unavailable' | 'unknown';

/**
 * MindSparkle does not perform tracking/attribution.
 * This module is intentionally a no-op so it cannot accidentally introduce ATT requirements.
 */
export const shouldRequestTrackingPermission = (): boolean => false;

export const ensureTrackingPermissionIfEnabled = async (): Promise<TrackingPermissionStatus> => 'unavailable';
