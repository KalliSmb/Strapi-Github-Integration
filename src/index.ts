import { syncRepositories } from './utils/github-sync';

export default {
  async bootstrap({ strapi }: { strapi: any }) {
    // Executa ao iniciar
    await syncRepositories(strapi);

    // Executa a cada 24 horas
    setInterval(() => {
      syncRepositories(strapi);
    }, 1000 * 60 * 60 * 24);
  },
};