import { supabase } from './client.js';

export interface Project {
  id: string;
  name: string;
  project_handle: string;
  voting_type: 'score' | 'token';
  token_address: string | null;
  owner_fid: number | null;
}

export async function getProjectByHandle(handle: string): Promise<Project | null> {
  const { data, error } = await supabase
    .from('projects')
    .select('id, name, project_handle, voting_type, token_address, owner_fid')
    .eq('project_handle', handle.toLowerCase())
    .single();

  if (error || !data) {
    return null;
  }

  return data as Project;
}

export async function getProjectById(id: string): Promise<Project | null> {
  const { data, error } = await supabase
    .from('projects')
    .select('id, name, project_handle, voting_type, token_address, owner_fid')
    .eq('id', id)
    .single();

  if (error || !data) {
    return null;
  }

  return data as Project;
}

export async function createProject(params: {
  name: string;
  project_handle: string;
  owner_fid: number;
  bio?: string;
  voting_type?: 'score' | 'token';
  token_address?: string;
  created_by_bot?: boolean;
}): Promise<Project> {
  const { data, error } = await supabase
    .from('projects')
    .insert({
      name: params.name,
      project_handle: params.project_handle.toLowerCase(),
      owner_fid: params.owner_fid,
      creator_fid: params.owner_fid,
      bio: params.bio || null,
      voting_type: params.voting_type || 'score',
      token_address: params.token_address || null,
      created_by_bot: params.created_by_bot ?? true,
      is_verified: false,
    })
    .select('id, name, project_handle, voting_type, token_address, owner_fid')
    .single();

  if (error) {
    throw new Error(`Failed to create project: ${error.message}`);
  }

  // Add owner as admin
  await supabase.from('project_admins').insert({
    project_id: data.id,
    fid: params.owner_fid,
    role: 'owner',
  });

  return data as Project;
}

export async function getAllProjects(): Promise<Project[]> {
  const { data, error } = await supabase
    .from('projects')
    .select('id, name, project_handle, voting_type, token_address, owner_fid')
    .order('name');

  if (error) {
    console.error('Failed to get projects:', error);
    return [];
  }

  return (data || []) as Project[];
}
