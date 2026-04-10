use std::path::PathBuf;
use std::sync::Arc;
use tokio::sync::Mutex;

use crate::mcp::types::*;

const CONFIG_FILENAME: &str = "mcp-servers.json";

/// Persistent storage for MCP server configurations
pub struct MCPConfigStore {
    config_dir: PathBuf,
}

impl MCPConfigStore {
    pub fn new(app_data_dir: PathBuf) -> Self {
        Self {
            config_dir: app_data_dir,
        }
    }

    fn config_path(&self) -> PathBuf {
        self.config_dir.join(CONFIG_FILENAME)
    }

    /// Load all server configurations from disk
    pub fn load(&self) -> Result<Vec<MCPServer>, MCPError> {
        let path = self.config_path();
        if !path.exists() {
            return Ok(Vec::new());
        }
        let data = std::fs::read_to_string(&path)
            .map_err(|e| MCPError::ConfigError(format!("Failed to read config: {}", e)))?;
        let servers: Vec<MCPServer> = serde_json::from_str(&data)
            .map_err(|e| MCPError::ConfigError(format!("Failed to parse config: {}", e)))?;
        Ok(servers)
    }

    /// Save all server configurations to disk
    fn save(&self, servers: &[MCPServer]) -> Result<(), MCPError> {
        std::fs::create_dir_all(&self.config_dir)
            .map_err(|e| MCPError::ConfigError(format!("Failed to create config dir: {}", e)))?;
        let data = serde_json::to_string_pretty(servers)
            .map_err(|e| MCPError::ConfigError(format!("Failed to serialize config: {}", e)))?;
        std::fs::write(self.config_path(), data)
            .map_err(|e| MCPError::ConfigError(format!("Failed to write config: {}", e)))?;
        Ok(())
    }

    /// Add a new server configuration
    pub fn add(&self, server: MCPServer) -> Result<MCPServer, MCPError> {
        let mut servers = self.load()?;
        if servers.iter().any(|s| s.id == server.id) {
            return Err(MCPError::ConfigError(format!(
                "Server with id '{}' already exists",
                server.id
            )));
        }
        servers.push(server.clone());
        self.save(&servers)?;
        Ok(server)
    }

    /// Update an existing server configuration
    pub fn update(&self, server: MCPServer) -> Result<MCPServer, MCPError> {
        let mut servers = self.load()?;
        let pos = servers.iter().position(|s| s.id == server.id).ok_or_else(|| {
            MCPError::ServerNotFound(server.id.clone())
        })?;
        servers[pos] = server.clone();
        self.save(&servers)?;
        Ok(server)
    }

    /// Remove a server configuration
    pub fn remove(&self, server_id: &str) -> Result<(), MCPError> {
        let mut servers = self.load()?;
        let len_before = servers.len();
        servers.retain(|s| s.id != server_id);
        if servers.len() == len_before {
            return Err(MCPError::ServerNotFound(server_id.into()));
        }
        self.save(&servers)?;
        Ok(())
    }

    /// Get a single server by ID
    pub fn get(&self, server_id: &str) -> Result<MCPServer, MCPError> {
        let servers = self.load()?;
        servers
            .into_iter()
            .find(|s| s.id == server_id)
            .ok_or_else(|| MCPError::ServerNotFound(server_id.into()))
    }
}

pub type SharedConfigStore = Arc<Mutex<MCPConfigStore>>;

pub fn new_shared_config_store(app_data_dir: PathBuf) -> SharedConfigStore {
    Arc::new(Mutex::new(MCPConfigStore::new(app_data_dir)))
}
