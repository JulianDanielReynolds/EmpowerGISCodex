export interface SessionTokens {
  accessToken: string;
  refreshToken: string;
}

export interface AuthUser {
  id: number;
  username: string;
  email: string;
  companyName: string;
  phoneNumber: string;
}

export interface PropertySnapshot {
  parcelKey: string;
  address: string;
  ownerName: string | null;
  acreage: number | null;
  zoningCode: string | null;
}
