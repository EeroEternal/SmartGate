-- Seed real free models into pool and virtual models branded as smartgate/...

-- 1. Ensure provider account for Free Pool
INSERT INTO provider_accounts (id, org_id, name, provider_type, protocol, base_url, api_key, status)
VALUES ('pa_openrouter_free', 'org_free_tokens', 'SmartGate Free Pool', 'openrouter', 'openai', 'https://openrouter.ai/api/v1', '', 'active')
ON CONFLICT (id) DO NOTHING;

-- 2. Update default free pool strategy to fallback for automatic failover
UPDATE model_pools SET strategy = 'fallback' WHERE id = 'pool_free_tokens';

-- 3. Seed dedicated model pools for each model
INSERT INTO model_pools (id, org_id, name, strategy, enabled)
VALUES
  ('pool_deepseek_r1', 'org_free_tokens', 'smartgate/deepseek-r1:1', 'priority', TRUE),
  ('pool_deepseek_chat', 'org_free_tokens', 'smartgate/deepseek-chat:1', 'priority', TRUE),
  ('pool_glm_4', 'org_free_tokens', 'smartgate/glm-4:1', 'priority', TRUE),
  ('pool_llama_3_3_70b', 'org_free_tokens', 'smartgate/llama-70b:1', 'priority', TRUE),
  ('pool_qwen_2_5_coder', 'org_free_tokens', 'smartgate/qwen-coder:1', 'priority', TRUE),
  ('pool_gemini_2_flash', 'org_free_tokens', 'smartgate/gemini-flash:1', 'priority', TRUE)
ON CONFLICT (id) DO NOTHING;

-- 4. Seed physical endpoints pointing to upstream free models
INSERT INTO endpoints (
    id, account_id, name, upstream_model_id, enabled, priority, weight,
    health_status, input_price_per_1m, output_price_per_1m, capability_score, supports_tools, context_length
) VALUES
  ('ep_or_deepseek_deepseek_r1_free', 'pa_openrouter_free', 'SmartGate DeepSeek R1', 'deepseek/deepseek-r1:free', TRUE, 10, 10, 'healthy', 0.0, 0.0, 0.95, 1, 65536),
  ('ep_or_deepseek_deepseek_chat_free', 'pa_openrouter_free', 'SmartGate DeepSeek V3', 'deepseek/deepseek-chat:free', TRUE, 10, 10, 'healthy', 0.0, 0.0, 0.90, 1, 65536),
  ('ep_or_thudm_glm_4_9b_chat_free', 'pa_openrouter_free', 'SmartGate GLM-4', 'thudm/glm-4-9b-chat:free', TRUE, 10, 10, 'healthy', 0.0, 0.0, 0.85, 1, 32768),
  ('ep_or_meta_llama_llama_3_3_70b_instruct_free', 'pa_openrouter_free', 'SmartGate Llama 3.3 70B', 'meta-llama/llama-3.3-70b-instruct:free', TRUE, 10, 10, 'healthy', 0.0, 0.0, 0.88, 1, 131072),
  ('ep_or_qwen_qwen_2_5_coder_32b_instruct_free', 'pa_openrouter_free', 'SmartGate Qwen 2.5 Coder', 'qwen/qwen-2.5-coder-32b-instruct:free', TRUE, 10, 10, 'healthy', 0.0, 0.0, 0.87, 1, 32768),
  ('ep_or_google_gemini_2_0_flash_exp_free', 'pa_openrouter_free', 'SmartGate Gemini 2.0 Flash', 'google/gemini-2.0-flash-exp:free', TRUE, 10, 10, 'healthy', 0.0, 0.0, 0.89, 1, 1048576)
ON CONFLICT (id) DO NOTHING;

-- 5. Bind endpoints to dedicated pools AND to pool_free_tokens (with priority for auto-failover)
INSERT INTO model_pool_endpoints (pool_id, endpoint_id, priority, weight)
VALUES
  ('pool_deepseek_r1', 'ep_or_deepseek_deepseek_r1_free', 10, 10),
  ('pool_deepseek_chat', 'ep_or_deepseek_deepseek_chat_free', 10, 10),
  ('pool_glm_4', 'ep_or_thudm_glm_4_9b_chat_free', 10, 10),
  ('pool_llama_3_3_70b', 'ep_or_meta_llama_llama_3_3_70b_instruct_free', 10, 10),
  ('pool_qwen_2_5_coder', 'ep_or_qwen_qwen_2_5_coder_32b_instruct_free', 10, 10),
  ('pool_gemini_2_flash', 'ep_or_google_gemini_2_0_flash_exp_free', 10, 10),
  -- In pool_free_tokens ordered by capability priority for smartgate/auto failover
  ('pool_free_tokens', 'ep_or_deepseek_deepseek_r1_free', 100, 10),
  ('pool_free_tokens', 'ep_or_deepseek_deepseek_chat_free', 90, 10),
  ('pool_free_tokens', 'ep_or_thudm_glm_4_9b_chat_free', 80, 10),
  ('pool_free_tokens', 'ep_or_qwen_qwen_2_5_coder_32b_instruct_free', 70, 10),
  ('pool_free_tokens', 'ep_or_meta_llama_llama_3_3_70b_instruct_free', 60, 10),
  ('pool_free_tokens', 'ep_or_google_gemini_2_0_flash_exp_free', 50, 10)
ON CONFLICT (pool_id, endpoint_id) DO UPDATE SET
  priority = EXCLUDED.priority,
  weight = EXCLUDED.weight;

-- 6. Seed SmartGate-branded Virtual Models including smartgate/auto
INSERT INTO virtual_models (id, pool_id, name, enabled)
VALUES
  -- Auto-failover model pointing to fallback pool
  ('vm_sg_auto', 'pool_free_tokens', 'smartgate/auto', TRUE),
  ('vm_free_auto', 'pool_free_tokens', 'auto', TRUE),
  -- Specific models
  ('vm_sg_deepseek_r1_1', 'pool_deepseek_r1', 'smartgate/deepseek-r1:1', TRUE),
  ('vm_sg_deepseek_chat_1', 'pool_deepseek_chat', 'smartgate/deepseek-chat:1', TRUE),
  ('vm_sg_glm_4_1', 'pool_glm_4', 'smartgate/glm-4:1', TRUE),
  ('vm_sg_qwen_coder_1', 'pool_qwen_2_5_coder', 'smartgate/qwen-coder:1', TRUE),
  ('vm_sg_llama_70b_1', 'pool_llama_3_3_70b', 'smartgate/llama-70b:1', TRUE),
  ('vm_sg_gemini_flash_1', 'pool_gemini_2_flash', 'smartgate/gemini-flash:1', TRUE),
  -- Short aliases
  ('vm_sg_deepseek_r1', 'pool_deepseek_r1', 'smartgate/deepseek-r1', TRUE),
  ('vm_sg_deepseek_chat', 'pool_deepseek_chat', 'smartgate/deepseek-chat', TRUE),
  ('vm_sg_glm_4', 'pool_glm_4', 'smartgate/glm-4', TRUE),
  ('vm_sg_qwen_coder', 'pool_qwen_2_5_coder', 'smartgate/qwen-coder', TRUE),
  ('vm_sg_llama_70b', 'pool_llama_3_3_70b', 'smartgate/llama-70b', TRUE),
  ('vm_sg_gemini_flash', 'pool_gemini_2_flash', 'smartgate/gemini-flash', TRUE),
  -- Compatibility with upstream raw names
  ('vm_or_deepseek_r1', 'pool_deepseek_r1', 'deepseek/deepseek-r1:free', TRUE),
  ('vm_or_deepseek_chat', 'pool_deepseek_chat', 'deepseek/deepseek-chat:free', TRUE),
  ('vm_or_glm_4', 'pool_glm_4', 'thudm/glm-4-9b-chat:free', TRUE),
  ('vm_or_llama_3_3_70b', 'pool_llama_3_3_70b', 'meta-llama/llama-3.3-70b-instruct:free', TRUE),
  ('vm_or_qwen_2_5_coder', 'pool_qwen_2_5_coder', 'qwen/qwen-2.5-coder-32b-instruct:free', TRUE),
  ('vm_or_gemini_2_flash', 'pool_gemini_2_flash', 'google/gemini-2.0-flash-exp:free', TRUE)
ON CONFLICT (id) DO UPDATE SET pool_id = EXCLUDED.pool_id, enabled = TRUE;

-- 7. Grant all virtual models to proj_free_tokens
INSERT INTO project_model_grants (project_id, virtual_model_id)
VALUES
  ('proj_free_tokens', 'vm_sg_auto'),
  ('proj_free_tokens', 'vm_free_auto'),
  ('proj_free_tokens', 'vm_sg_deepseek_r1_1'),
  ('proj_free_tokens', 'vm_sg_deepseek_chat_1'),
  ('proj_free_tokens', 'vm_sg_glm_4_1'),
  ('proj_free_tokens', 'vm_sg_qwen_coder_1'),
  ('proj_free_tokens', 'vm_sg_llama_70b_1'),
  ('proj_free_tokens', 'vm_sg_gemini_flash_1'),
  ('proj_free_tokens', 'vm_sg_deepseek_r1'),
  ('proj_free_tokens', 'vm_sg_deepseek_chat'),
  ('proj_free_tokens', 'vm_sg_glm_4'),
  ('proj_free_tokens', 'vm_sg_qwen_coder'),
  ('proj_free_tokens', 'vm_sg_llama_70b'),
  ('proj_free_tokens', 'vm_sg_gemini_flash'),
  ('proj_free_tokens', 'vm_or_deepseek_r1'),
  ('proj_free_tokens', 'vm_or_deepseek_chat'),
  ('proj_free_tokens', 'vm_or_glm_4'),
  ('proj_free_tokens', 'vm_or_llama_3_3_70b'),
  ('proj_free_tokens', 'vm_or_qwen_2_5_coder'),
  ('proj_free_tokens', 'vm_or_gemini_2_flash')
ON CONFLICT (project_id, virtual_model_id) DO NOTHING;
