import { useState, useEffect } from 'react'
import { Plus, X, Key, FolderPlus, Link2, Pencil } from 'lucide-react'
import Select from '../../components/Select'
import { adminFetch } from '../../lib/api'

interface Project {
  id: string
  name: string
  org_id: string
  rpm_limit?: number | null
  concurrency_limit?: number | null
}

interface Org {
  id: string
  name: string
}

interface ApiKey {
  id: string
  name: string
  key_prefix: string
  project_id: string
  rpm_limit?: number | null
  concurrency_limit?: number | null
  created_at: string
}

interface VirtualModel {
  id: string
  name: string
  pool_name: string
}

interface Grant {
  project_id: string
  project_name: string
  virtual_model_id: string
  virtual_model_name: string
}

function formatLimit(value?: number | null) {
  return value == null ? 'Unlimited' : String(value)
}

export default function AccessControl() {
  const [orgs, setOrgs] = useState<Org[]>([])
  const [projects, setProjects] = useState<Project[]>([])
  const [keys, setKeys] = useState<ApiKey[]>([])
  const [models, setModels] = useState<VirtualModel[]>([])
  const [grants, setGrants] = useState<Grant[]>([])

  const [isKeyModalOpen, setIsKeyModalOpen] = useState(false)
  const [isProjectModalOpen, setIsProjectModalOpen] = useState(false)
  const [isGrantModalOpen, setIsGrantModalOpen] = useState(false)
  const [quotaTarget, setQuotaTarget] = useState<
    | { kind: 'project'; id: string; name: string; rpm_limit?: number | null; concurrency_limit?: number | null }
    | { kind: 'key'; id: string; name: string; rpm_limit?: number | null; concurrency_limit?: number | null }
    | null
  >(null)
  const [newKey, setNewKey] = useState<{ name: string; project_id: string; key?: string } | null>(null)

  const [selectedProject, setSelectedProject] = useState<{ id: string; name: string } | null>(null)
  const [selectedOrg, setSelectedOrg] = useState<{ id: string; name: string } | null>(null)
  const [selectedModel, setSelectedModel] = useState<{ id: string; name: string } | null>(null)
  const [keyForm, setKeyForm] = useState({ name: '', rpm_limit: '', concurrency_limit: '' })
  const [projectForm, setProjectForm] = useState({ name: '', description: '', rpm_limit: '', concurrency_limit: '' })
  const [quotaForm, setQuotaForm] = useState({ rpm_limit: '', concurrency_limit: '' })
  const [submitting, setSubmitting] = useState(false)

  useEffect(() => {
    fetchData()
  }, [])

  const fetchData = async () => {
    const [oData, pData, kData, mData, gData] = await Promise.all([
      adminFetch('/api/admin/orgs'),
      adminFetch('/api/admin/projects'),
      adminFetch('/api/admin/api-keys'),
      adminFetch('/api/admin/virtual-models'),
      adminFetch('/api/admin/grants'),
    ])
    if (oData.success) {
      setOrgs(oData.data)
      if (oData.data.length > 0) setSelectedOrg({ id: oData.data[0].id, name: oData.data[0].name })
    }
    if (pData.success) {
      setProjects(pData.data)
      if (pData.data.length > 0) setSelectedProject({ id: pData.data[0].id, name: pData.data[0].name })
    }
    if (kData.success) setKeys(kData.data)
    if (mData.success) {
      setModels(mData.data)
      if (mData.data.length > 0) setSelectedModel({ id: mData.data[0].id, name: mData.data[0].name })
    }
    if (gData.success) setGrants(gData.data)
  }

  const ensureDefaultOrg = async () => {
    if (orgs.length > 0) return orgs[0]
    const data = await adminFetch('/api/admin/orgs', {
      method: 'POST',
      body: JSON.stringify({ name: 'Default Org', description: 'Auto-created default organization' }),
    })
    if (!data.success) throw new Error(data.message || 'Failed to create org')
    setOrgs([data.data])
    setSelectedOrg({ id: data.data.id, name: data.data.name })
    return data.data as Org
  }

  const handleCreateProject = async (e: React.FormEvent) => {
    e.preventDefault()
    setSubmitting(true)
    try {
      const org = selectedOrg ? { id: selectedOrg.id } : await ensureDefaultOrg()
      await adminFetch('/api/admin/projects', {
        method: 'POST',
        body: JSON.stringify({
          org_id: org.id,
          name: projectForm.name,
          description: projectForm.description || null,
          rpm_limit: projectForm.rpm_limit ? parseInt(projectForm.rpm_limit, 10) : null,
          concurrency_limit: projectForm.concurrency_limit
            ? parseInt(projectForm.concurrency_limit, 10)
            : null,
        }),
      })
      setIsProjectModalOpen(false)
      setProjectForm({ name: '', description: '', rpm_limit: '', concurrency_limit: '' })
      await fetchData()
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Failed to create project')
    } finally {
      setSubmitting(false)
    }
  }

  const handleCreateKey = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!selectedProject?.id) return
    setSubmitting(true)
    try {
      const data = await adminFetch('/api/admin/api-keys', {
        method: 'POST',
        body: JSON.stringify({
          project_id: selectedProject.id,
          name: keyForm.name,
          rpm_limit: keyForm.rpm_limit ? parseInt(keyForm.rpm_limit, 10) : null,
          concurrency_limit: keyForm.concurrency_limit
            ? parseInt(keyForm.concurrency_limit, 10)
            : null,
        }),
      })
      setNewKey(data.data)
      setKeyForm({ name: '', rpm_limit: '', concurrency_limit: '' })
      await fetchData()
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Failed to create API key')
    } finally {
      setSubmitting(false)
    }
  }

  const handleGrant = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!selectedProject?.id || !selectedModel?.id) return
    setSubmitting(true)
    try {
      await adminFetch('/api/admin/projects/grant', {
        method: 'POST',
        body: JSON.stringify({
          project_id: selectedProject.id,
          virtual_model_id: selectedModel.id,
        }),
      })
      setIsGrantModalOpen(false)
      await fetchData()
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Failed to grant model')
    } finally {
      setSubmitting(false)
    }
  }

  const handleRevoke = async (grant: Grant) => {
    if (!confirm(`Revoke ${grant.virtual_model_name} from ${grant.project_name}?`)) return
    try {
      await adminFetch('/api/admin/projects/revoke', {
        method: 'POST',
        body: JSON.stringify({
          project_id: grant.project_id,
          virtual_model_id: grant.virtual_model_id,
        }),
      })
      await fetchData()
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Failed to revoke grant')
    }
  }

  const openQuotaEditor = (
    kind: 'project' | 'key',
    item: { id: string; name: string; rpm_limit?: number | null; concurrency_limit?: number | null }
  ) => {
    setQuotaTarget({ kind, ...item })
    setQuotaForm({
      rpm_limit: item.rpm_limit == null ? '' : String(item.rpm_limit),
      concurrency_limit: item.concurrency_limit == null ? '' : String(item.concurrency_limit),
    })
  }

  const handleSaveQuota = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!quotaTarget) return
    setSubmitting(true)
    try {
      const path =
        quotaTarget.kind === 'project'
          ? `/api/admin/projects/${quotaTarget.id}`
          : `/api/admin/api-keys/${quotaTarget.id}`
      await adminFetch(path, {
        method: 'PATCH',
        body: JSON.stringify({
          rpm_limit: quotaForm.rpm_limit ? parseInt(quotaForm.rpm_limit, 10) : null,
          concurrency_limit: quotaForm.concurrency_limit
            ? parseInt(quotaForm.concurrency_limit, 10)
            : null,
        }),
      })
      setQuotaTarget(null)
      await fetchData()
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Failed to update quota')
    } finally {
      setSubmitting(false)
    }
  }

  const projectName = (projectId: string) =>
    projects.find((p) => p.id === projectId)?.name || projectId.slice(0, 8)

  return (
    <div className="max-w-6xl mx-auto space-y-8">
      <div className="flex items-center justify-between gap-4 flex-wrap">
        <div>
          <h2 className="text-2xl font-bold text-zinc-900">Access Control</h2>
          <p className="text-sm text-zinc-500 mt-1">
            Manage projects, API keys, model grants, and request limits.
          </p>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <button
            onClick={() => setIsGrantModalOpen(true)}
            className="flex items-center gap-2 px-4 py-2 text-sm font-medium border border-zinc-300 rounded-md hover:bg-zinc-50"
          >
            <Link2 className="w-4 h-4" /> Grant Model
          </button>
          <button
            onClick={() => setIsProjectModalOpen(true)}
            className="flex items-center gap-2 px-4 py-2 text-sm font-medium border border-zinc-300 rounded-md hover:bg-zinc-50"
          >
            <FolderPlus className="w-4 h-4" /> New Project
          </button>
          <button
            onClick={() => {
              setNewKey(null)
              setIsKeyModalOpen(true)
            }}
            className="flex items-center gap-2 px-4 py-2 bg-black text-white text-sm font-medium rounded-md hover:bg-zinc-800"
          >
            <Key className="w-4 h-4" /> Issue API Key
          </button>
        </div>
      </div>

      <div className="bg-white border border-zinc-200 rounded-lg shadow-sm overflow-hidden">
        <div className="px-6 py-4 border-b border-zinc-200 font-bold">Projects</div>
        <table className="w-full text-left text-sm">
          <thead className="bg-zinc-50 text-zinc-600 border-b border-zinc-200">
            <tr>
              <th className="px-6 py-3">Name</th>
              <th className="px-6 py-3">RPM Limit</th>
              <th className="px-6 py-3">Concurrency</th>
              <th className="px-6 py-3 text-right">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-zinc-200">
            {projects.length === 0 ? (
              <tr>
                <td colSpan={4} className="px-6 py-8 text-center text-zinc-500">
                  No projects yet. Create one to start issuing keys.
                </td>
              </tr>
            ) : (
              projects.map((project) => (
                <tr key={project.id}>
                  <td className="px-6 py-3 font-medium">{project.name}</td>
                  <td className="px-6 py-3 font-mono">{formatLimit(project.rpm_limit)}</td>
                  <td className="px-6 py-3 font-mono">{formatLimit(project.concurrency_limit)}</td>
                  <td className="px-6 py-3 text-right">
                    <button
                      onClick={() => openQuotaEditor('project', project)}
                      className="inline-flex items-center gap-1 text-zinc-500 hover:text-black"
                    >
                      <Pencil className="w-3.5 h-3.5" /> Edit Limits
                    </button>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      <div className="bg-white border border-zinc-200 rounded-lg shadow-sm overflow-hidden">
        <div className="px-6 py-4 border-b border-zinc-200 font-bold">Model Grants</div>
        <table className="w-full text-left text-sm">
          <thead className="bg-zinc-50 text-zinc-600 border-b border-zinc-200">
            <tr>
              <th className="px-6 py-3">Project</th>
              <th className="px-6 py-3">Virtual Model</th>
              <th className="px-6 py-3 text-right">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-zinc-200">
            {grants.length === 0 ? (
              <tr>
                <td colSpan={3} className="px-6 py-8 text-center text-zinc-500">
                  No grants yet. Grant a virtual model so project keys can call it.
                </td>
              </tr>
            ) : (
              grants.map((grant) => (
                <tr key={`${grant.project_id}:${grant.virtual_model_id}`}>
                  <td className="px-6 py-3">{grant.project_name}</td>
                  <td className="px-6 py-3 font-mono">{grant.virtual_model_name}</td>
                  <td className="px-6 py-3 text-right">
                    <button
                      onClick={() => handleRevoke(grant)}
                      className="text-rose-600 hover:text-rose-800 font-medium"
                    >
                      Revoke
                    </button>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      <div className="bg-white border border-zinc-200 rounded-lg shadow-sm overflow-hidden">
        <div className="px-6 py-4 border-b border-zinc-200 font-bold">API Keys</div>
        <table className="w-full text-left text-sm">
          <thead className="bg-zinc-50 text-zinc-600 border-b border-zinc-200">
            <tr>
              <th className="px-6 py-3">Name</th>
              <th className="px-6 py-3">Project</th>
              <th className="px-6 py-3">Prefix</th>
              <th className="px-6 py-3">RPM</th>
              <th className="px-6 py-3">Concurrency</th>
              <th className="px-6 py-3">Created</th>
              <th className="px-6 py-3 text-right">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-zinc-200">
            {keys.length === 0 ? (
              <tr>
                <td colSpan={7} className="px-6 py-8 text-center text-zinc-500">No API keys issued yet.</td>
              </tr>
            ) : (
              keys.map((key) => (
                <tr key={key.id}>
                  <td className="px-6 py-3">{key.name}</td>
                  <td className="px-6 py-3">{projectName(key.project_id)}</td>
                  <td className="px-6 py-3 font-mono">{key.key_prefix}****</td>
                  <td className="px-6 py-3 font-mono">{formatLimit(key.rpm_limit)}</td>
                  <td className="px-6 py-3 font-mono">{formatLimit(key.concurrency_limit)}</td>
                  <td className="px-6 py-3">{new Date(key.created_at).toLocaleDateString()}</td>
                  <td className="px-6 py-3 text-right">
                    <button
                      onClick={() => openQuotaEditor('key', key)}
                      className="inline-flex items-center gap-1 text-zinc-500 hover:text-black"
                    >
                      <Pencil className="w-3.5 h-3.5" /> Edit Limits
                    </button>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {isProjectModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50">
          <div className="bg-white rounded-lg w-full max-w-md border border-zinc-200">
            <div className="px-6 py-4 border-b flex justify-between items-center">
              <h3 className="font-bold">Create Project</h3>
              <button onClick={() => setIsProjectModalOpen(false)}>
                <X className="w-4 h-4" />
              </button>
            </div>
            <form onSubmit={handleCreateProject} className="p-6 space-y-4">
              {orgs.length > 0 && selectedOrg && (
                <Select
                  label="Organization"
                  options={orgs.map((o) => ({ id: o.id, name: o.name }))}
                  selected={selectedOrg}
                  onChange={(opt) => setSelectedOrg({ id: String(opt.id), name: opt.name })}
                />
              )}
              <div>
                <label className="block text-sm font-medium text-zinc-700 mb-1">Project Name</label>
                <input
                  required
                  className="w-full border border-zinc-300 rounded-md px-3 py-2 text-sm focus:outline-none focus:border-black focus:ring-1 focus:ring-black"
                  value={projectForm.name}
                  onChange={(e) => setProjectForm({ ...projectForm, name: e.target.value })}
                />
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-zinc-700 mb-1">RPM Limit</label>
                  <input
                    type="number"
                    min="1"
                    placeholder="Unlimited"
                    className="w-full border border-zinc-300 rounded-md px-3 py-2 text-sm font-mono"
                    value={projectForm.rpm_limit}
                    onChange={(e) => setProjectForm({ ...projectForm, rpm_limit: e.target.value })}
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-zinc-700 mb-1">Concurrency</label>
                  <input
                    type="number"
                    min="1"
                    placeholder="Unlimited"
                    className="w-full border border-zinc-300 rounded-md px-3 py-2 text-sm font-mono"
                    value={projectForm.concurrency_limit}
                    onChange={(e) =>
                      setProjectForm({ ...projectForm, concurrency_limit: e.target.value })
                    }
                  />
                </div>
              </div>
              <button type="submit" disabled={submitting} className="w-full bg-black text-white py-2 rounded-md disabled:opacity-50">
                {submitting ? 'Creating...' : 'Create Project'}
              </button>
            </form>
          </div>
        </div>
      )}

      {isGrantModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50">
          <div className="bg-white rounded-lg w-full max-w-md border border-zinc-200">
            <div className="px-6 py-4 border-b flex justify-between items-center">
              <h3 className="font-bold">Grant Virtual Model</h3>
              <button onClick={() => setIsGrantModalOpen(false)}>
                <X className="w-4 h-4" />
              </button>
            </div>
            <form onSubmit={handleGrant} className="p-6 space-y-4">
              {projects.length === 0 || models.length === 0 ? (
                <p className="text-sm text-zinc-500">
                  Need at least one project and one virtual model before granting access.
                </p>
              ) : (
                <>
                  <Select
                    label="Project"
                    options={projects.map((p) => ({ id: p.id, name: p.name }))}
                    selected={selectedProject || { id: '', name: 'Select project...' }}
                    onChange={(opt) => setSelectedProject({ id: String(opt.id), name: opt.name })}
                  />
                  <Select
                    label="Virtual Model"
                    options={models.map((m) => ({ id: m.id, name: m.name }))}
                    selected={selectedModel || { id: '', name: 'Select model...' }}
                    onChange={(opt) => setSelectedModel({ id: String(opt.id), name: opt.name })}
                  />
                  <button
                    type="submit"
                    disabled={submitting || !selectedProject?.id || !selectedModel?.id}
                    className="w-full bg-black text-white py-2 rounded-md disabled:opacity-50"
                  >
                    {submitting ? 'Granting...' : 'Grant Access'}
                  </button>
                </>
              )}
            </form>
          </div>
        </div>
      )}

      {isKeyModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50">
          <div className="bg-white rounded-lg w-full max-w-md border border-zinc-200">
            <div className="px-6 py-4 border-b flex justify-between items-center">
              <h3 className="font-bold">Issue New API Key</h3>
              <button
                onClick={() => {
                  setIsKeyModalOpen(false)
                  setNewKey(null)
                }}
              >
                <X className="w-4 h-4" />
              </button>
            </div>
            {newKey?.key ? (
              <div className="p-6 space-y-4">
                <div className="p-4 bg-zinc-100 rounded-md font-mono text-xs break-all border border-zinc-200">
                  {newKey.key}
                </div>
                <p className="text-sm text-zinc-500">Copy this key now. It will not be shown again.</p>
                <button className="w-full bg-black text-white py-2 rounded-md" onClick={() => setIsKeyModalOpen(false)}>
                  Done
                </button>
              </div>
            ) : (
              <form onSubmit={handleCreateKey} className="p-6 space-y-4">
                {projects.length === 0 ? (
                  <p className="text-sm text-zinc-500">Create a project first before issuing a key.</p>
                ) : (
                  <>
                    <Select
                      label="Project"
                      options={projects.map((p) => ({ id: p.id, name: p.name }))}
                      selected={selectedProject || { id: '', name: 'Select project...' }}
                      onChange={(opt) => setSelectedProject({ id: String(opt.id), name: opt.name })}
                    />
                    <div>
                      <label className="block text-sm font-medium text-zinc-700 mb-1">Key Name</label>
                      <input
                        required
                        className="w-full border border-zinc-300 rounded-md px-3 py-2 text-sm"
                        value={keyForm.name}
                        onChange={(e) => setKeyForm({ ...keyForm, name: e.target.value })}
                      />
                    </div>
                    <div className="grid grid-cols-2 gap-4">
                      <div>
                        <label className="block text-sm font-medium text-zinc-700 mb-1">RPM Limit</label>
                        <input
                          type="number"
                          min="1"
                          placeholder="Unlimited"
                          className="w-full border border-zinc-300 rounded-md px-3 py-2 text-sm font-mono"
                          value={keyForm.rpm_limit}
                          onChange={(e) => setKeyForm({ ...keyForm, rpm_limit: e.target.value })}
                        />
                      </div>
                      <div>
                        <label className="block text-sm font-medium text-zinc-700 mb-1">Concurrency</label>
                        <input
                          type="number"
                          min="1"
                          placeholder="Unlimited"
                          className="w-full border border-zinc-300 rounded-md px-3 py-2 text-sm font-mono"
                          value={keyForm.concurrency_limit}
                          onChange={(e) => setKeyForm({ ...keyForm, concurrency_limit: e.target.value })}
                        />
                      </div>
                    </div>
                    <button
                      type="submit"
                      disabled={submitting || !selectedProject?.id}
                      className="w-full bg-black text-white py-2 rounded-md disabled:opacity-50"
                    >
                      {submitting ? 'Generating...' : 'Generate'}
                    </button>
                  </>
                )}
              </form>
            )}
          </div>
        </div>
      )}

      {quotaTarget && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50">
          <div className="bg-white rounded-lg w-full max-w-md border border-zinc-200">
            <div className="px-6 py-4 border-b flex justify-between items-center">
              <h3 className="font-bold">
                Edit Limits · {quotaTarget.name}
              </h3>
              <button onClick={() => setQuotaTarget(null)}>
                <X className="w-4 h-4" />
              </button>
            </div>
            <form onSubmit={handleSaveQuota} className="p-6 space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-zinc-700 mb-1">RPM Limit</label>
                  <input
                    type="number"
                    min="1"
                    placeholder="Unlimited"
                    className="w-full border border-zinc-300 rounded-md px-3 py-2 text-sm font-mono"
                    value={quotaForm.rpm_limit}
                    onChange={(e) => setQuotaForm({ ...quotaForm, rpm_limit: e.target.value })}
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-zinc-700 mb-1">Concurrency</label>
                  <input
                    type="number"
                    min="1"
                    placeholder="Unlimited"
                    className="w-full border border-zinc-300 rounded-md px-3 py-2 text-sm font-mono"
                    value={quotaForm.concurrency_limit}
                    onChange={(e) => setQuotaForm({ ...quotaForm, concurrency_limit: e.target.value })}
                  />
                </div>
              </div>
              <p className="text-xs text-zinc-500">Leave blank for unlimited.</p>
              <button type="submit" disabled={submitting} className="w-full bg-black text-white py-2 rounded-md disabled:opacity-50">
                {submitting ? 'Saving...' : 'Save Limits'}
              </button>
            </form>
          </div>
        </div>
      )}
    </div>
  )
}
