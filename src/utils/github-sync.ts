import fetch from 'node-fetch';

type Repository = {
  name: string;
  full_name: string;
  html_url: string;
  description: string | null;
  language: string | null;
  owner: { login: string };
};

type PackageJson = {
  dependencies?: Record<string, string>;
};

type GitHubFileResponse = {
  content: string;
  encoding: string;
};

type LibraryIoResponse = {
  latest_release_number: string;
};

const GITHUB_TOKEN = process.env.GITHUB_TOKEN!;
const LIBRARIES_API_KEY = process.env.LIBRARIES_IO_API_KEY!;
const GITHUB_USER_ORG = process.env.GITHUB_ORG_OR_USER!;
const BASE_URL = 'https://api.github.com';

const headers = {
  Authorization: `Bearer ${GITHUB_TOKEN}`,
  Accept: 'application/vnd.github+json',
};

export const syncRepositories = async (strapi: any, force = false) => {
  const response = await fetch(`${BASE_URL}/orgs/${GITHUB_USER_ORG}/repos?per_page=100&type=all`, { headers });
  const repos = (await response.json()) as Repository[];
  if (!Array.isArray(repos)) return;

  const oneHourAgo = new Date(Date.now() - 1000 * 60 * 60).toISOString();

  for (const repo of repos) {
    if (!force) {
      // Verifica se houve commits na última hora
      const commitsRes = await fetch(
        `${BASE_URL}/repos/${repo.owner.login}/${repo.name}/commits?since=${oneHourAgo}`,
        { headers }
      );
      if (!commitsRes.ok) continue;
      const commits = await commitsRes.json();
      if (!Array.isArray(commits) || commits.length === 0) {
        // Não houve commits na última hora, pula para o próximo repositório
        continue;
      }
    }

    // Verifica se o repositório já existe, se não cria
    let repositoryEntry;
    try {
      const existing = await strapi.entityService.findMany('api::repository.repository', {
        filters: { full_name: repo.full_name },
        limit: 1,
      });

      if (existing.length > 0) {
        repositoryEntry = existing[0];
        // Atualiza dados do repositório
        repositoryEntry = await strapi.entityService.update('api::repository.repository', repositoryEntry.id, {
          data: {
            name: repo.name,
            html_url: repo.html_url,
            description: repo.description,
            language: repo.language,
            owner: repo.owner.login,
          },
        });
      } else {
        // Cria novo repositório
        repositoryEntry = await strapi.entityService.create('api::repository.repository', {
          data: {
            name: repo.name,
            full_name: repo.full_name,
            html_url: repo.html_url,
            description: repo.description,
            language: repo.language,
            owner: repo.owner.login,
          },
        });
      }
    } catch (error) {
      console.error(`Erro ao criar/atualizar repositório ${repo.full_name}:`, error);
      continue;
    }

    // Fetch package.json
    const pkgResponse = await fetch(`${BASE_URL}/repos/${repo.owner.login}/${repo.name}/contents/package.json`, {
      headers,
    });

    if (!pkgResponse.ok) continue;

    const pkg = (await pkgResponse.json()) as GitHubFileResponse;

    const decoded = Buffer.from(pkg.content, 'base64').toString();
    const json: PackageJson = JSON.parse(decoded);
    const dependencies = json.dependencies || {};

    // Para cada dependência, cria ou atualiza entrada ligada ao repositório
    for (const [dep, version] of Object.entries(dependencies)) {
      try {
        // Verifica se já existe a dependência para este repositório
        const existingDeps = await strapi.entityService.findMany('api::dependency.dependency', {
          filters: {
            name: dep,
            repository: repositoryEntry.id,
          },
          limit: 1,
        });

        // Busca versão mais recente no libraries.io
        const libRes = await fetch(`https://libraries.io/api/npm/${dep}?api_key=${LIBRARIES_API_KEY}`);
        if (!libRes.ok) continue;

        const libData = (await libRes.json()) as LibraryIoResponse;
        const latest = libData.latest_release_number;

        if (existingDeps.length > 0) {
          // Atualiza dependência existente
          await strapi.entityService.update('api::dependency.dependency', existingDeps[0].id, {
            data: {
              current_version: version,
              latest_version: latest,
              outdated: latest !== version,
              repository: repositoryEntry.id,
            },
          });
        } else {
          // Cria nova dependência
          await strapi.entityService.create('api::dependency.dependency', {
            data: {
              name: dep,
              current_version: version,
              latest_version: latest,
              outdated: latest !== version,
              repository: repositoryEntry.id,
            },
          });
        }
      } catch (error) {
        console.error(`Erro ao criar/atualizar dependência ${dep} no repo ${repo.full_name}:`, error);
      }
    }
  }
};