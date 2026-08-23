import { sqliteTable, text, integer, index } from 'drizzle-orm/sqlite-core';


export const users = sqliteTable('users', {
  id: text('id').primaryKey(),
  email: text('email').notNull().unique(),
  passwordHash: text('password_hash').notNull(),
  createdAt: integer('created_at', { mode: 'timestamp' }).notNull(),
});

export const routes = sqliteTable('routes', {
  id: text('id').primaryKey(),
  userId: text('user_id').references(() => users.id), // foreign key
  origin: text('origin').notNull(),
  destination: text('destination').notNull(),
  routeGeometry: text('route_geometry'), // omitted or JSON stringified
  createdAt: integer('created_at', { mode: 'timestamp' }).notNull(),
}, (table) => {
  return {
    createdAtIndex: index('created_at_idx').on(table.createdAt),
    userIdIndex: index('user_id_idx').on(table.userId),
  };
});

export const watchedRoutes = sqliteTable('watched_routes', {
  id: text('id').primaryKey(),
  userId: text('user_id').references(() => users.id).notNull(),
  routeId: text('route_id').references(() => routes.id).notNull(),
  thresholdSeverity: text('threshold_severity').notNull(), // 'warning' | 'critical'
  createdAt: integer('created_at', { mode: 'timestamp' }).notNull(),
}, (table) => {
  return {
    userIdIndex: index('watched_user_id_idx').on(table.userId),
  };
});

export const alerts = sqliteTable('alerts', {
  id: text('id').primaryKey(),
  userId: text('user_id').references(() => users.id).notNull(),
  watchedRouteId: text('watched_route_id').references(() => watchedRoutes.id).notNull(),
  message: text('message').notNull(),
  read: integer('read', { mode: 'boolean' }).default(false).notNull(),
  createdAt: integer('created_at', { mode: 'timestamp' }).notNull(),
}, (table) => {
  return {
    userIdIndex: index('alert_user_id_idx').on(table.userId),
    unreadIndex: index('alert_unread_idx').on(table.userId, table.read),
  };
});
