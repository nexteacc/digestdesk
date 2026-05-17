import "express";

declare global {
  namespace Express {
    interface Request {
      userId?: string;
      adminUser?: {
        id: string;
        clerkId: string;
        email: string;
        name: string | null;
        avatarUrl: string | null;
        createdAt: string;
        lastLoginAt: string;
      };
    }
  }
}

export {};
