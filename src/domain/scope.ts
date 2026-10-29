import { Schema } from "mongoose";

export type OrganizationScope = {
  type: "organization";
  organizationId: string;
};

export type EmployeeScope = {
  type: "employee";
  organizationId: string;
  employeeIds: string[];
};

export type ConversationScope = {
  type: "conversation";
  organizationId: string;
  conversationId: string;
};

export type KnowledgeScope = OrganizationScope | EmployeeScope | ConversationScope;

export type RetrievalContext = {
  organizationId: string;
  employeeId?: string;
  conversationId?: string;
};

export const scopeSchema = new Schema(
  {
    type: { type: String, enum: ["organization", "employee", "conversation"], required: true },
    organizationId: { type: String, required: true },
    employeeIds: { type: [String], default: undefined },
    conversationId: { type: String },
  },
  { _id: false, strict: "throw" },
);

export function isValidStoredScope(scope: KnowledgeScope): boolean {
  if (!scope.organizationId) return false;
  const value = scope as KnowledgeScope & { employeeIds?: string[]; conversationId?: string };
  if (scope.type === "organization") return !value.employeeIds && !value.conversationId;
  if (scope.type === "employee") return Boolean(value.employeeIds?.length && !value.conversationId);
  return Boolean(value.conversationId && !value.employeeIds);
}

export function buildScopeFilter(context: RetrievalContext, field = "scope") {
  const allowed: Array<Record<string, string>> = [{ [`${field}.type`]: "organization" }];
  if (context.employeeId) {
    allowed.push({ [`${field}.type`]: "employee", [`${field}.employeeIds`]: context.employeeId });
  }
  if (context.conversationId) {
    allowed.push({
      [`${field}.type`]: "conversation",
      [`${field}.conversationId`]: context.conversationId,
    });
  }
  return { organizationId: context.organizationId, $or: allowed };
}
