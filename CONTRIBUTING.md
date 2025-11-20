# Contributing to AutoFlow Pro

## Getting Started

1. **Fork the repository**
2. **Clone your fork**:

```bash
git clone https://github.com/YOUR_USERNAME/autoflow-pro.git
cd autoflow-pro
```

3. **Add upstream remote**:

```bash
git remote add upstream https://github.com/ORIGINAL_OWNER/autoflow-pro.git
```

4. **Create a branch**:

```bash
git checkout -b feature/your-feature-name
```

## Development Setup

### Prerequisites

- Node.js 22 LTS
- PostgreSQL (or Supabase account)
- Redis (or Upstash account)

### Install Dependencies

```bash
# Backend
cd backend
npm install

# Frontend
cd frontend
npm install
```

### Environment Variables

Copy example files and fill in values:

```bash
cd backend && cp .env.example .env
cd frontend && cp .env.example .env.local
```

### Run Development Servers

**Backend** (port 4000):

```bash
cd backend
npm run dev
```

**Frontend** (port 3000):

```bash
cd frontend
npm run dev
```

## Code Style

### TypeScript

- Use TypeScript strict mode
- No `any` types without justification
- Export types from `types/` directory
- Use interfaces over type aliases for object shapes

### Formatting

- **Indentation**: 2 spaces
- **Semicolons**: Required
- **Quotes**: Double quotes
- **Line Length**: 120 characters max
- **Trailing Commas**: Required

### Comments

- **Minimal comments** - code should be self-documenting
- Comment only for:
  - Complex business logic
  - Non-obvious workarounds
  - "Why" decisions, not "what" code does

**Good**:

```typescript
// Retry with exponential backoff to handle rate limiting
const delay = Math.min(baseDelay * Math.pow(2, attempt), maxDelay);
```

**Bad**:

```typescript
// Set the delay variable to the base delay times 2 to the power of attempt
const delay = baseDelay * Math.pow(2, attempt);
```

### Naming Conventions

- **Variables/Functions**: camelCase
- **Types/Interfaces**: PascalCase
- **Constants**: UPPER_SNAKE_CASE
- **Files**: kebab-case or PascalCase (components)

**Examples**:

```typescript
const userEmail = "test@example.com";
interface WorkflowDefinition {}
const MAX_RETRIES = 3;
```

## Project Structure

### Backend

```
backend/src/
├── api/           # Route handlers
├── config/        # Configuration (Supabase, Redis, etc)
├── middleware/    # Request middleware
├── services/      # Business logic
├── types/         # TypeScript types
├── utils/         # Utility functions
└── websocket/     # WebSocket handlers
```

**Guidelines**:

- Keep route handlers thin - delegate to services
- Services contain business logic
- Utils are pure functions
- Types exported from `types/index.ts`

### Frontend

```
frontend/
├── app/           # Next.js App Router pages
├── components/    # React components
│   ├── workflow/  # Workflow-related
│   ├── execution/ # Execution-related
│   └── dashboard/ # Dashboard components
├── lib/           # Utilities and API client
└── types/         # TypeScript types
```

**Guidelines**:

- Server components by default
- `'use client'` for interactive components
- Extract reusable logic to custom hooks
- Keep components focused and small

## Testing

### Backend Tests

```bash
cd backend

# Run specific test suites
npm run test:connection    # Database
npm run test:queue         # Queue
npm run test:automation    # Browser automation
npm run test:api          # API endpoints
```

### Writing Tests

Use descriptive test names:

```typescript
// Good
test("should create workflow with valid definition", async () => {
  // ...
});

// Bad
test("create workflow", async () => {
  // ...
});
```

## Adding Features

### New Step Type

1. **Add to backend types** (`backend/src/types/database.ts`):

```typescript
export type StepType = "existing_types" | "your_new_type";
```

2. **Implement step method** (`backend/src/services/AutomationEngine.ts`):

```typescript
private async stepYourNewType(
  step: WorkflowStep,
  resources: BrowserResources,
  context: ExecutionContext
): Promise<StepResult> {
  // Implementation
}
```

3. **Add to frontend constants** (`frontend/components/workflow-builder/constants.ts`):

```typescript
{
  type: "your_new_type",
  label: "Your New Type",
  description: "Description of what it does",
  category: "Interaction",
  color: "#color-code"
}
```

4. **Add validation** (`frontend/components/workflow-builder/nodeTypes.ts`)
5. **Add UI form** (`frontend/components/workflow-builder/ConfigPanel.tsx`)

### New API Endpoint

1. **Define route** (`backend/src/api/your-route.ts`):

```typescript
export async function yourRoutes(fastify: FastifyInstance) {
  fastify.get(
    "/your-endpoint",
    { preHandler: authenticate },
    async (request, reply) => {
      // Implementation
    }
  );
}
```

2. **Register route** (`backend/src/index.ts`):

```typescript
await fastify.register(yourRoutes, { prefix: "/api" });
```

3. **Add to API client** (`frontend/lib/api.ts`):

```typescript
export const yourApi = {
  method: () => apiRequest<ResponseType>("/your-endpoint"),
};
```

## Pull Request Process

### Before Submitting

1. **Test your changes**:

```bash
# Backend
cd backend
npm run build
npx tsc --noEmit

# Frontend
cd frontend
npm run build
npm run lint
```

2. **Update documentation**:

- Add to relevant docs/ files
- Update README if needed
- Add JSDoc comments for new functions

3. **Write tests** for new features

### Commit Messages

Use conventional commit format:

```
type(scope): description

[optional body]

[optional footer]
```

**Types**:

- `feat`: New feature
- `fix`: Bug fix
- `docs`: Documentation only
- `style`: Code style (formatting, no logic change)
- `refactor`: Code change that neither fixes a bug nor adds a feature
- `perf`: Performance improvement
- `test`: Adding or fixing tests
- `chore`: Maintenance tasks

**Examples**:

```
feat(workflow): add drag-and-drop step type
fix(execution): resolve memory leak in browser cleanup
docs(api): update authentication endpoints
```

### Pull Request Template

```markdown
## Description

[Describe your changes]

## Type of Change

- [ ] Bug fix
- [ ] New feature
- [ ] Breaking change
- [ ] Documentation update

## Testing

- [ ] Unit tests pass
- [ ] Integration tests pass
- [ ] Manual testing completed

## Checklist

- [ ] Code follows style guidelines
- [ ] Self-review completed
- [ ] Comments added for complex logic
- [ ] Documentation updated
- [ ] No new warnings introduced
```

## Code Review

### What We Look For

1. **Correctness**: Does it work as intended?
2. **Testing**: Are there adequate tests?
3. **Style**: Follows project conventions?
4. **Performance**: No obvious performance issues?
5. **Security**: No security vulnerabilities?
6. **Documentation**: Changes documented?

### Addressing Feedback

- Respond to all comments
- Push new commits for changes
- Don't force push after review started
- Mark conversations as resolved when addressed

## Performance Guidelines

### Backend

- Use database indexes for queries
- Implement caching where appropriate
- Close connections and clean up resources
- Use connection pooling
- Avoid N+1 queries

### Frontend

- Use React.memo for expensive components
- Implement code splitting for large pages
- Lazy load images and components
- Debounce user input (300ms)
- Use virtual scrolling for long lists

## Security

### Never Commit

- API keys, tokens, passwords
- Service role keys
- Sensitive user data
- `.env` files (use `.env.example`)

### Input Validation

- Validate all user input
- Sanitize before database queries
- Use prepared statements
- Escape HTML output
- Validate file uploads

### Authentication

- Always use `preHandler: authenticate` for protected routes
- Check user authorization for resources
- Use Row Level Security in Supabase
- Implement rate limiting

## Documentation

### Code Documentation

**Functions**:

```typescript
/**
 * Creates a new workflow for the user
 * @param userId - User ID
 * @param data - Workflow data
 * @returns Created workflow
 */
async function createWorkflow(userId: string, data: WorkflowData) {
  // ...
}
```

**Types**:

```typescript
/**
 * Represents a workflow step configuration
 */
export interface StepConfig {
  selector?: string; // CSS selector
  url?: string; // Target URL
  value?: string; // Input value
}
```

### User Documentation

When adding features:

1. Update relevant docs/ files
2. Add examples and use cases
3. Include screenshots if UI changes
4. Update troubleshooting if needed

## Getting Help

- **Questions**: Open a GitHub Discussion
- **Bugs**: Open an Issue with reproduction steps
- **Features**: Open an Issue with detailed description
- **Security**: Email security@example.com (private disclosure)

## Recognition

Contributors will be:

- Listed in README acknowledgments
- Credited in release notes
- Given special contributor badge (if applicable)

Thank you for contributing to AutoFlow Pro! 🚀
