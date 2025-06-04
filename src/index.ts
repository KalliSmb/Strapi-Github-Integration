import { syncRepositories } from './utils/github-sync';

export default {
  async bootstrap({ strapi }: { strapi: any }) {
    // Executa ao iniciar (força o refresh completo)
    await syncRepositories(strapi, true);

    // Executa a cada 1 hora (apenas se houver commits)
    setInterval(() => {
      syncRepositories(strapi);
    }, 1000 * 60 * 60);
  },
};