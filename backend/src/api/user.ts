import { FastifyInstance } from "fastify";
import { authenticate } from "../middleware/authenticate.js";
import { supabase } from "../config/supabase.js";

export async function userRoutes(fastify: FastifyInstance) {
  fastify.get(
    "/user/profile",
    { preHandler: authenticate },
    async (request, reply) => {
      try {
        const { data: user, error } = await supabase.auth.admin.getUserById(
          request.user!.id
        );

        if (error || !user) {
          return reply.status(404).send({
            error: "User not found",
            message: error?.message,
          });
        }

        return reply.send({
          id: user.user.id,
          email: user.user.email,
          created_at: user.user.created_at,
          updated_at: user.user.updated_at,
        });
      } catch (error: any) {
        return reply.status(500).send({
          error: "Failed to fetch user profile",
          message: error.message,
        });
      }
    }
  );
}
