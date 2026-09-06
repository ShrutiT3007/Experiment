-- Experiment Service metadata store.
-- This DB stores ONLY what the Experiment Service generated/observed.
-- It never duplicates the application/business database that the
-- existing QA framework already owns.

CREATE TABLE IF NOT EXISTS experiments (
  id BIGINT AUTO_INCREMENT PRIMARY KEY,
  uuid VARCHAR(64) NOT NULL UNIQUE,
  hypothesis TEXT NOT NULL,
  status VARCHAR(32) NOT NULL DEFAULT 'CREATED',
  hypothesis_result VARCHAR(32) NULL,
  experiment_type VARCHAR(32) NULL,
  environment_id VARCHAR(64) NULL,
  definition_json JSON NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  started_at DATETIME NULL,
  completed_at DATETIME NULL,
  error TEXT NULL,
  INDEX idx_experiments_status (status),
  INDEX idx_experiments_created_at (created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS experiment_executions (
  id BIGINT AUTO_INCREMENT PRIMARY KEY,
  uuid VARCHAR(64) NOT NULL UNIQUE,
  experiment_id BIGINT NOT NULL,
  qa_execution_id VARCHAR(128) NULL,
  status VARCHAR(32) NOT NULL DEFAULT 'RUNNING',
  started_at DATETIME NULL,
  completed_at DATETIME NULL,
  duration_ms INT NULL,
  metadata_json JSON NULL,
  CONSTRAINT fk_executions_experiment
    FOREIGN KEY (experiment_id) REFERENCES experiments(id) ON DELETE CASCADE,
  INDEX idx_executions_experiment (experiment_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS experiment_testcases (
  id BIGINT AUTO_INCREMENT PRIMARY KEY,
  experiment_id BIGINT NOT NULL,
  execution_id BIGINT NULL,
  qa_testcase_id BIGINT NULL,
  name VARCHAR(255) NULL,
  definition_json JSON NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_testcases_experiment
    FOREIGN KEY (experiment_id) REFERENCES experiments(id) ON DELETE CASCADE,
  CONSTRAINT fk_testcases_execution
    FOREIGN KEY (execution_id) REFERENCES experiment_executions(id) ON DELETE SET NULL,
  INDEX idx_testcases_experiment (experiment_id),
  INDEX idx_testcases_qa_id (qa_testcase_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS experiment_flows (
  id BIGINT AUTO_INCREMENT PRIMARY KEY,
  experiment_id BIGINT NOT NULL,
  execution_id BIGINT NULL,
  qa_flow_id BIGINT NULL,
  definition_json JSON NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_flows_experiment
    FOREIGN KEY (experiment_id) REFERENCES experiments(id) ON DELETE CASCADE,
  CONSTRAINT fk_flows_execution
    FOREIGN KEY (execution_id) REFERENCES experiment_executions(id) ON DELETE SET NULL,
  INDEX idx_flows_experiment (experiment_id),
  INDEX idx_flows_qa_id (qa_flow_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS experiment_assertions (
  id BIGINT AUTO_INCREMENT PRIMARY KEY,
  experiment_id BIGINT NOT NULL,
  execution_id BIGINT NULL,
  type VARCHAR(32) NOT NULL,
  expected_json JSON NULL,
  actual_json JSON NULL,
  passed BOOLEAN NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_assertions_experiment
    FOREIGN KEY (experiment_id) REFERENCES experiments(id) ON DELETE CASCADE,
  CONSTRAINT fk_assertions_execution
    FOREIGN KEY (execution_id) REFERENCES experiment_executions(id) ON DELETE SET NULL,
  INDEX idx_assertions_experiment (experiment_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS experiment_evidence (
  id BIGINT AUTO_INCREMENT PRIMARY KEY,
  experiment_id BIGINT NOT NULL,
  execution_id BIGINT NULL,
  source VARCHAR(64) NOT NULL,
  type VARCHAR(64) NOT NULL,
  summary TEXT NOT NULL,
  data_json JSON NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_evidence_experiment
    FOREIGN KEY (experiment_id) REFERENCES experiments(id) ON DELETE CASCADE,
  CONSTRAINT fk_evidence_execution
    FOREIGN KEY (execution_id) REFERENCES experiment_executions(id) ON DELETE SET NULL,
  INDEX idx_evidence_experiment (experiment_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
