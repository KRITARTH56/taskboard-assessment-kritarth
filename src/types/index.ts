export type Role = "admin" | "member" | "viewer";
export type TaskStatus = "todo" | "in_progress" | "review" | "done";
export type ActivityEventType =
  | "task_created"
  | "task_status_changed"
  | "task_assignee_changed"
  | "comment_added";

export type ApiUser = {
  id: string;
  email: string;
  name: string;
};

export type ApiTask = {
  id: string;
  projectId: string;
  title: string;
  description: string | null;
  status: TaskStatus;
  assigneeId: string | null;
  createdById: string;
  position: number;
  createdAt: string;
  updatedAt: string;
  assignee?: ApiUser | null;
};

export type ApiComment = {
  id: string;
  taskId: string;
  projectId: string;
  authorId: string;
  body: string;
  createdAt: string;
  author: ApiUser;
};

export type ApiActivityEvent = {
  id: string;
  projectId: string;
  actorId: string;
  taskId: string | null;
  commentId: string | null;
  type: ActivityEventType;
  /** Arbitrary JSON — shape depends on event type */
  meta: Record<string, unknown>;
  createdAt: string;
  actor: ApiUser;
  task?: { id: string; title: string } | null;
};

export type ApiProjectMember = {
  id: string;
  role: Role;
  user: ApiUser & { passwordHash?: string };
};

export type ApiProjectDetail = {
  id: string;
  name: string;
  description: string | null;
  ownerId: string;
  owner: ApiUser & { passwordHash?: string };
  memberships: ApiProjectMember[];
  tasks: ApiTask[];
  createdAt: string;
  updatedAt: string;
};

export const STATUS_LABELS: Record<TaskStatus, string> = {
  todo: "To do",
  in_progress: "In progress",
  review: "In review",
  done: "Done",
};

export const STATUS_ORDER: TaskStatus[] = ["todo", "in_progress", "review", "done"];

export const ACTIVITY_LABELS: Record<ActivityEventType, string> = {
  task_created: "created task",
  task_status_changed: "changed status",
  task_assignee_changed: "changed assignee",
  comment_added: "commented on",
};
