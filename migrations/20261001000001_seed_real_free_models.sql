-- Seed real OpenRouter free models into pool and virtual models

-- 1. Ensure provider account for OpenRouter Free Pool
INSERT INTO provider_accounts (id, org_id, name, provider_type, protocol, base_url, api_key, status)
VALUES ('pa_openrouter_free', 'org_free_tokens', 'OpenRouter Free Pool', 'openrouter', 'openai', 'https://openrouter.ai/api/v1', '', 'active')
ON CONFLICT (id) DO NOTHING;

-- 2. Seed dedicated model pools for each model
INSERT INTO model_pools (id, org_id, name, strategy, enabled)
VALUES
  ('pool_deepseek_r1', 'org_free_tokens', 'deepseek/deepseek-r1:free', 'priority', TRUE),
  ('pool_deepseek_chat', 'org_free_tokens', 'deepseek/deepseek-chat:free', 'priority', TRUE),
  ('pool_glm_4', 'org_free_tokens', 'thudm/glm-4-9b-chat:free', 'priority', TRUE),
  ('pool_llama_3_3_70b', 'org_free_tokens', 'meta-llama/llama-3.3-70b-instruct:free', 'priority', TRUE),
  ('pool_qwen_2_5_coder', 'org_free_tokens', 'qwen/qwen-2.5-coder-32b-instruct:free', 'priority', TRUE),
  ('pool_gemini_2_flash', 'org_free_tokens', 'google/gemini-2.0-flash-exp:free', 'priority', TRUE)
ON CONFLICT (id) DO NOTHING;

-- 3. Seed physical endpoints
INSERT INTO endpoints (
    id, account_id, name, upstream_model_id, enabled, priority, weight,
    health_status, input_price_per_1m, output_price_per_1m, capability_score, supports_tools, context_length
) VALUES
  ('ep_or_deepseek_deepseek_r1_free', 'pa_openrouter_free', 'DeepSeek: R1 (free)', 'deepseek/deepseek-r1:free', TRUE, 10, 10, 'healthy', 0.0, 0.0, 0.95, 1, 65536),
  ('ep_or_deepseek_deepseek_chat_free', 'pa_openrouter_free', 'DeepSeek: DeepSeek V3 (free)', 'deepseek/deepseek-chat:free', TRUE, 10, 10, 'healthy', 0.0, 0.0, 0.90, 1, 65536),
  ('ep_or_thudm_glm_4_9b_chat_free', 'pa_openrouter_free', 'Zhipu AI: GLM-4 9B Chat (free)', 'thudm/glm-4-9b-chat:free', TRUE, 10, 10, 'healthy', 0.0, 0.0, 0.85, 1, 32768),
  ('ep_or_meta_llama_llama_3_3_70b_instruct_free', 'pa_openrouter_free', 'Meta: Llama 3.3 70B Instruct (free)', 'meta-llama/llama-3.3-70b-instruct:free', TRUE, 10, 10, 'healthy', 0.0, 0.0, 0.88, 1, 131072),
  ('ep_or_qwen_qwen_2_5_coder_32b_instruct_free', 'pa_openrouter_free', 'Qwen: Qwen 2.5 Coder 32B Instruct (free)', 'qwen/qwen-2.5-coder-32b-instruct:free', TRUE, 10, 10, 'healthy', 0.0, 0.0, 0.87, 1, 32768),
  ('ep_or_google_gemini_2_0_flash_exp_free', 'pa_openrouter_free', 'Google: Gemini 2.0 Flash Experimental (free)', 'google/gemini-2.0-flash-exp:free', TRUE, 10, 10, 'healthy', 0.0, 0.0, 0.89, 1, 1048576)
ON CONFLICT (id) DO NOTHING;

-- 4. Bind endpoints to their dedicated pool AND to pool_free_tokens
INSERT INTO model_pool_endpoints (pool_id, endpoint_id, priority, weight)
VALUES
  ('pool_deepseek_r1', 'ep_or_deepseek_deepseek_r1_free', 10, 10),
  ('pool_deepseek_chat', 'ep_or_deepseek_deepseek_chat_free', 10, 10),
  ('pool_glm_4', 'ep_or_thudm_glm_4_9b_chat_free', 10, 10),
  ('pool_llama_3_3_70b', 'ep_or_meta_llama_llama_3_3_70b_instruct_free', 10, 10),
  ('pool_qwen_2_5_coder', 'ep_or_qwen_qwen_2_5_coder_32b_instruct_free', 10, 10),
  ('pool_gemini_2_flash', 'ep_or_google_gemini_2_0_flash_exp_free', 10, 10),
  ('pool_free_tokens', 'ep_or_deepseek_deepseek_r1_free', 10, 10),
  ('pool_free_tokens', 'ep_or_deepseek_deepseek_chat_free', 10, 10),
  ('pool_free_tokens', 'ep_or_thudm_glm_4_9b_chat_free', 10, 10),
  ('pool_free_tokens', 'ep_or_meta_llama_llama_3_3_70b_instruct_free', 10, 10),
  ('pool_free_tokens', 'ep_or_qwen_qwen_2_5_coder_32b_instruct_free', 10, 10),
  ('pool_free_tokens', 'ep_or_google_gemini_2_0_flash_exp_free', 10, 10)
ON CONFLICT (pool_id, endpoint_id) DO NOTHING;

-- 5. Seed Virtual Models matching the exact OpenRouter free model names
INSERT INTO virtual_models (id, pool_id, name, enabled)
VALUES
  ('vm_or_deepseek_r1', 'pool_deepseek_r1', 'deepseek/deepseek-r1:free', TRUE),
  ('vm_or_deepseek_chat', 'pool_deepseek_chat', 'deepseek/deepseek-chat:free', TRUE),
  ('vm_or_glm_4', 'pool_glm_4', 'thudm/glm-4-9b-chat:free', TRUE),
  ('vm_or_llama_3_3_70b', 'pool_llama_3_3_70b', 'meta-llama/llama-3.3-70b-instruct:free', TRUE),
  ('vm_or_qwen_2_5_coder', 'pool_qwen_2_5_coder', 'qwen/qwen-2.5-coder-32b-instruct:free', TRUE),
  ('vm_or_gemini_2_flash', 'pool_gemini_2_flash', 'google/gemini-2.0-flash-exp:free', TRUE)
ON CONFLICT (id) DO NOTHING;

-- Also seed short alias virtual models for convenient usage
INSERT INTO virtual_models (id, pool_id, name, enabled)
VALUES
  ('vm_alias_deepseek_r1', 'pool_deepseek_r1', 'deepseek-r1', TRUE),
  ('vm_alias_deepseek_chat', 'pool_deepseek_chat', 'deepseek-chat', TRUE),
  ('vm_alias_glm_4', 'pool_glm_4', 'glm-4', TRUE)
ON CONFLICT (id) DO NOTHING;

-- 6. Grant all virtual models to proj_free_tokens
INSERT INTO project_model_grants (project_id, virtual_model_id)
VALUES
  ('proj_free_tokens', 'vm_or_deepseek_r1'),
  ('proj_free_tokens', 'vm_or_deepseek_chat'),
  ('proj_free_tokens', 'vm_or_glm_4'),
  ('proj_free_tokens', 'vm_or_llama_3_3_70b'),
  ('proj_free_tokens', 'vm_or_qwen_2_5_coder'),
  ('proj_free_tokens', 'vm_or_gemini_2_flash'),
  ('proj_free_tokens', 'vm_alias_deepseek_r1'),
  ('proj_free_tokens', 'vm_alias_deepseek_chat'),
  ('proj_free_tokens', 'vm_alias_glm_4')
ON CONFLICT (project_id, virtual_model_id) DO NOTHING;
