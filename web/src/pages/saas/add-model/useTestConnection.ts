import { useState } from 'react'
import { saasFetch } from '../../../lib/saasApi'
import { useI18n } from '../../../lib/i18n'
import type { DraftEndpoint, SaasProvider } from '../types'

// Owns the "Test connection" state machine and request for the new-credential form.
export function useTestConnection({ useExisting, selectedAccount, draft, selectedModelIds }: {
  useExisting: boolean
  selectedAccount: SaasProvider | undefined
  draft: DraftEndpoint
  selectedModelIds: string[]
}) {
  const { t } = useI18n()
  const [testStatus, setTestStatus] = useState<'idle' | 'testing' | 'passed' | 'failed'>('idle')
  const [testMsg, setTestMsg] = useState('')

  async function runTestKey() {
    const modelToTest = draft.upstream_model_id.trim() || selectedModelIds[0] || ''
    if (!modelToTest) return
    setTestStatus('testing')
    setTestMsg('')
    try {
      const res = await saasFetch<{ passed?: boolean; message?: string }>('/api/saas/test-connection', {
        method: 'POST',
        body: JSON.stringify({
          protocol: useExisting ? (selectedAccount?.protocol || 'openai') : draft.protocol,
          base_url: useExisting ? (selectedAccount?.base_url || draft.base_url) : draft.base_url.trim(),
          api_key: draft.api_key.trim(),
          upstream_model_id: modelToTest,
        }),
      })
      if (res.success && (res.data?.passed !== false)) {
        setTestStatus('passed')
        setTestMsg(res.data?.message || (t('services.test_passed')))
      } else {
        setTestStatus('failed')
        setTestMsg(res.message || (t('services.test_failed')))
      }
    } catch (e: any) {
      setTestStatus('failed')
      setTestMsg(e.message || (t('services.test_failed')))
    }
  }

  return { testStatus, testMsg, setTestStatus, runTestKey }
}
