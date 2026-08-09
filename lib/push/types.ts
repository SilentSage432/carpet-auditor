/**
 * Web Push domain — subscription storage shapes + payload contract.
 * Presentation consumes; dispatch owns send side-effects.
 */

export type PushSubscriptionJSON = {
  endpoint: string;
  expirationTime?: number | null;
  keys: {
    p256dh: string;
    auth: string;
  };
};

export type PushSubscriptionRow = {
  id: string;
  user_id: string | null;
  specialist_id: string | null;
  department_code: string | null;
  endpoint: string;
  subscription_json: PushSubscriptionJSON;
  created_at: string;
};

export type RotationPushPayload = {
  title: string;
  body: string;
  url: string;
  tag: string;
  department_id?: string;
  department_code?: string;
  assigned_week?: string;
  bay_count?: number;
};
