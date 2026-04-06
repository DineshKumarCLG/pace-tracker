/// <reference path="../pb_data/types.d.ts" />

/**
 * Sync Validator Hook
 *
 * Validates incoming sync data from desktop clients before persisting.
 * Ensures data integrity constraints are maintained server-side.
 */

// Validate session records on create/update
onRecordBeforeCreateRequest((e) => {
  const record = e.record;

  // Validate timestamps are positive integers
  const startTime = record.getInt("startTime");
  if (startTime <= 0) {
    throw new BadRequestError("startTime must be a positive Unix timestamp");
  }

  // Validate endTime >= startTime when set
  const endTime = record.getInt("endTime");
  if (endTime && endTime < startTime) {
    throw new BadRequestError("endTime must be >= startTime");
  }

  // Validate startType
  const startType = record.getString("startType");
  const validStartTypes = ["manual", "backfill", "recovered"];
  if (startType && !validStartTypes.includes(startType)) {
    throw new BadRequestError("Invalid startType: " + startType);
  }
}, "sessions");

onRecordBeforeUpdateRequest((e) => {
  const record = e.record;

  const startTime = record.getInt("startTime");
  const endTime = record.getInt("endTime");
  if (endTime && startTime && endTime < startTime) {
    throw new BadRequestError("endTime must be >= startTime");
  }
}, "sessions");

// Validate session_tasks: times within parent session
onRecordBeforeCreateRequest((e) => {
  const record = e.record;
  const sessionId = record.getString("sessionId");

  if (!sessionId) {
    throw new BadRequestError("sessionId is required");
  }

  const startTime = record.getInt("startTime");
  if (startTime <= 0) {
    throw new BadRequestError("startTime must be a positive Unix timestamp");
  }
}, "session_tasks");

// Validate breaks: type must be valid
onRecordBeforeCreateRequest((e) => {
  const record = e.record;
  const breakType = record.getString("type");
  const validTypes = ["lunch", "short", "meeting", "discarded"];

  if (breakType && !validTypes.includes(breakType)) {
    throw new BadRequestError("Invalid break type: " + breakType);
  }

  const startTime = record.getInt("startTime");
  if (startTime <= 0) {
    throw new BadRequestError("startTime must be a positive Unix timestamp");
  }
}, "breaks");

// Validate tasks: required fields
onRecordBeforeCreateRequest((e) => {
  const record = e.record;
  const title = record.getString("title");

  if (!title || title.trim() === "") {
    throw new BadRequestError("Task title is required");
  }

  const status = record.getString("status");
  const validStatuses = ["open", "inprogress", "done", "blocked"];
  if (status && !validStatuses.includes(status)) {
    throw new BadRequestError("Invalid task status: " + status);
  }

  const priority = record.getString("priority");
  const validPriorities = ["high", "medium", "low"];
  if (priority && !validPriorities.includes(priority)) {
    throw new BadRequestError("Invalid priority: " + priority);
  }
}, "tasks");
