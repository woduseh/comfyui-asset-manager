import {
  ModuleRepository,
  ModuleItemRepository,
  WorkflowRepository,
  BatchJobRepository,
  BatchTaskRepository
} from '../../database/repositories'

export const moduleRepo = new ModuleRepository()
export const moduleItemRepo = new ModuleItemRepository()
export const workflowRepo = new WorkflowRepository()
export const batchJobRepo = new BatchJobRepository()
export const batchTaskRepo = new BatchTaskRepository()
