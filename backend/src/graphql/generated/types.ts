import type { GraphQLResolveInfo, GraphQLScalarType, GraphQLScalarTypeConfig } from 'graphql';
import type { WorkflowModel, RunModel } from '../store.js';
import type { GraphQLContext } from '../context.js';
export type Maybe<T> = T | null;
export type InputMaybe<T> = Maybe<T>;
export type Omit<T, K extends keyof T> = Pick<T, Exclude<keyof T, K>>;
export type RequireFields<T, K extends keyof T> = Omit<T, K> & { [P in K]-?: NonNullable<T[P]> };
/** All built-in and custom scalars, mapped to their actual values */
export type Scalars = {
  ID: { input: string; output: string; }
  String: { input: string; output: string; }
  Boolean: { input: boolean; output: boolean; }
  Int: { input: number; output: number; }
  Float: { input: number; output: number; }
  /** A moment in time as an ISO 8601 string in UTC. */
  DateTime: { input: string; output: string; }
};

export type CancelRunResult = ConflictError | NotFoundError | Run | UnavailableError | ValidationError;

export type ConflictError = UserError & {
  __typename?: 'ConflictError';
  code: ErrorCode;
  message: Scalars['String']['output'];
  /** The state the run is in. */
  state: RunState;
};

export type CreateWorkflowInput = {
  description?: InputMaybe<Scalars['String']['input']>;
  name: Scalars['String']['input'];
  steps: Array<StepInput>;
};

export type CreateWorkflowResult = ValidationError | Workflow;

export type ErrorCode =
  | 'CONFLICT'
  | 'NOT_FOUND'
  | 'UNAVAILABLE'
  | 'VALIDATION';

export type FieldIssue = {
  __typename?: 'FieldIssue';
  message: Scalars['String']['output'];
  path: Scalars['String']['output'];
};

export type Mutation = {
  __typename?: 'Mutation';
  /** Sends the cancel signal to the run's Temporal workflow. The run reaches CANCELLED a moment later. */
  cancelRun: CancelRunResult;
  createWorkflow: CreateWorkflowResult;
  /** Creates a run and starts its Temporal workflow. */
  startRun: StartRunResult;
};


export type MutationCancelRunArgs = {
  runId: Scalars['ID']['input'];
};


export type MutationCreateWorkflowArgs = {
  input: CreateWorkflowInput;
};


export type MutationStartRunArgs = {
  input: StartRunInput;
};

export type NotFoundError = UserError & {
  __typename?: 'NotFoundError';
  code: ErrorCode;
  id: Scalars['ID']['output'];
  message: Scalars['String']['output'];
  resource: Scalars['String']['output'];
};

export type PageInfo = {
  __typename?: 'PageInfo';
  endCursor?: Maybe<Scalars['String']['output']>;
  hasNextPage: Scalars['Boolean']['output'];
};

export type Query = {
  __typename?: 'Query';
  run?: Maybe<Run>;
  /** Newest first. Cursor pagination: pass the endCursor of the last page as after. */
  runs: RunConnection;
  workflow?: Maybe<Workflow>;
  workflows: WorkflowConnection;
};


export type QueryRunArgs = {
  id: Scalars['ID']['input'];
};


export type QueryRunsArgs = {
  after?: InputMaybe<Scalars['String']['input']>;
  first?: InputMaybe<Scalars['Int']['input']>;
  state?: InputMaybe<RunState>;
  workflowId?: InputMaybe<Scalars['ID']['input']>;
};


export type QueryWorkflowArgs = {
  id: Scalars['ID']['input'];
};


export type QueryWorkflowsArgs = {
  after?: InputMaybe<Scalars['String']['input']>;
  first?: InputMaybe<Scalars['Int']['input']>;
};

export type Run = {
  __typename?: 'Run';
  /** True once a cancel was asked for, until the run reaches its final state. */
  cancelRequested: Scalars['Boolean']['output'];
  completedSteps: Array<Scalars['String']['output']>;
  createdAt: Scalars['DateTime']['output'];
  error?: Maybe<Scalars['String']['output']>;
  finishedAt?: Maybe<Scalars['DateTime']['output']>;
  id: Scalars['ID']['output'];
  startedAt?: Maybe<Scalars['DateTime']['output']>;
  state: RunState;
  totalSteps: Scalars['Int']['output'];
  workflow: Workflow;
};

export type RunConnection = {
  __typename?: 'RunConnection';
  edges: Array<RunEdge>;
  pageInfo: PageInfo;
  totalCount: Scalars['Int']['output'];
};

export type RunEdge = {
  __typename?: 'RunEdge';
  cursor: Scalars['String']['output'];
  node: Run;
};

export type RunState =
  | 'CANCELLED'
  | 'COMPLETED'
  | 'FAILED'
  | 'QUEUED'
  | 'RUNNING'
  | 'TIMED_OUT';

export type StartRunInput = {
  /** Budget for one step including its retries, 100 to 3600000 ms. */
  stepTimeoutMs?: InputMaybe<Scalars['Int']['input']>;
  workflowId: Scalars['ID']['input'];
};

export type StartRunResult = NotFoundError | Run | UnavailableError | ValidationError;

export type Step = {
  __typename?: 'Step';
  id: Scalars['ID']['output'];
  type: Scalars['String']['output'];
};

export type StepInput = {
  id: Scalars['ID']['input'];
  type: Scalars['String']['input'];
};

export type UnavailableError = UserError & {
  __typename?: 'UnavailableError';
  code: ErrorCode;
  message: Scalars['String']['output'];
};

export type UserError = {
  code: ErrorCode;
  message: Scalars['String']['output'];
};

export type ValidationError = UserError & {
  __typename?: 'ValidationError';
  code: ErrorCode;
  issues: Array<FieldIssue>;
  message: Scalars['String']['output'];
};

export type Workflow = {
  __typename?: 'Workflow';
  createdAt: Scalars['DateTime']['output'];
  description?: Maybe<Scalars['String']['output']>;
  id: Scalars['ID']['output'];
  /** Its newest run, if any. */
  lastRun?: Maybe<Run>;
  name: Scalars['String']['output'];
  /** How many runs this workflow has had. */
  runCount: Scalars['Int']['output'];
  runs: RunConnection;
  steps: Array<Step>;
};


export type WorkflowRunsArgs = {
  after?: InputMaybe<Scalars['String']['input']>;
  first?: InputMaybe<Scalars['Int']['input']>;
};

export type WorkflowConnection = {
  __typename?: 'WorkflowConnection';
  edges: Array<WorkflowEdge>;
  pageInfo: PageInfo;
  totalCount: Scalars['Int']['output'];
};

export type WorkflowEdge = {
  __typename?: 'WorkflowEdge';
  cursor: Scalars['String']['output'];
  node: Workflow;
};



export type ResolverTypeWrapper<T> = Promise<T> | T;


export type ResolverWithResolve<TResult, TParent, TContext, TArgs> = {
  resolve: ResolverFn<TResult, TParent, TContext, TArgs>;
};
export type Resolver<TResult, TParent = Record<PropertyKey, never>, TContext = Record<PropertyKey, never>, TArgs = Record<PropertyKey, never>> = ResolverFn<TResult, TParent, TContext, TArgs> | ResolverWithResolve<TResult, TParent, TContext, TArgs>;

export type ResolverFn<TResult, TParent, TContext, TArgs> = (
  parent: TParent,
  args: TArgs,
  context: TContext,
  info: GraphQLResolveInfo
) => Promise<TResult> | TResult;

export type SubscriptionSubscribeFn<TResult, TParent, TContext, TArgs> = (
  parent: TParent,
  args: TArgs,
  context: TContext,
  info: GraphQLResolveInfo
) => AsyncIterable<TResult> | Promise<AsyncIterable<TResult>>;

export type SubscriptionResolveFn<TResult, TParent, TContext, TArgs> = (
  parent: TParent,
  args: TArgs,
  context: TContext,
  info: GraphQLResolveInfo
) => TResult | Promise<TResult>;

export interface SubscriptionSubscriberObject<TResult, TKey extends string, TParent, TContext, TArgs> {
  subscribe: SubscriptionSubscribeFn<{ [key in TKey]: TResult }, TParent, TContext, TArgs>;
  resolve?: SubscriptionResolveFn<TResult, { [key in TKey]: TResult }, TContext, TArgs>;
}

export interface SubscriptionResolverObject<TResult, TParent, TContext, TArgs> {
  subscribe: SubscriptionSubscribeFn<any, TParent, TContext, TArgs>;
  resolve: SubscriptionResolveFn<TResult, any, TContext, TArgs>;
}

export type SubscriptionObject<TResult, TKey extends string, TParent, TContext, TArgs> =
  | SubscriptionSubscriberObject<TResult, TKey, TParent, TContext, TArgs>
  | SubscriptionResolverObject<TResult, TParent, TContext, TArgs>;

export type SubscriptionResolver<TResult, TKey extends string, TParent = Record<PropertyKey, never>, TContext = Record<PropertyKey, never>, TArgs = Record<PropertyKey, never>> =
  | ((...args: any[]) => SubscriptionObject<TResult, TKey, TParent, TContext, TArgs>)
  | SubscriptionObject<TResult, TKey, TParent, TContext, TArgs>;

export type TypeResolveFn<TTypes, TParent = Record<PropertyKey, never>, TContext = Record<PropertyKey, never>> = (
  parent: TParent,
  context: TContext,
  info: GraphQLResolveInfo
) => Maybe<TTypes> | Promise<Maybe<TTypes>>;

export type IsTypeOfResolverFn<T = Record<PropertyKey, never>, TContext = Record<PropertyKey, never>> = (obj: T, context: TContext, info: GraphQLResolveInfo) => boolean | Promise<boolean>;

export type NextResolverFn<T> = () => Promise<T>;

export type DirectiveResolverFn<TResult = Record<PropertyKey, never>, TParent = Record<PropertyKey, never>, TContext = Record<PropertyKey, never>, TArgs = Record<PropertyKey, never>> = (
  next: NextResolverFn<TResult>,
  parent: TParent,
  args: TArgs,
  context: TContext,
  info: GraphQLResolveInfo
) => TResult | Promise<TResult>;



/** Mapping of union types */
export type ResolversUnionTypes<_RefType extends Record<string, unknown>> = {
  CancelRunResult:
    | ( ConflictError )
    | ( NotFoundError )
    | ( RunModel )
    | ( UnavailableError )
    | ( ValidationError )
  ;
  CreateWorkflowResult:
    | ( ValidationError )
    | ( WorkflowModel )
  ;
  StartRunResult:
    | ( NotFoundError )
    | ( RunModel )
    | ( UnavailableError )
    | ( ValidationError )
  ;
};

/** Mapping of interface types */
export type ResolversInterfaceTypes<_RefType extends Record<string, unknown>> = {
  UserError:
    | ( ConflictError )
    | ( NotFoundError )
    | ( UnavailableError )
    | ( ValidationError )
  ;
};

/** Mapping between all available schema types and the resolvers types */
export type ResolversTypes = {
  Boolean: ResolverTypeWrapper<Scalars['Boolean']['output']>;
  CancelRunResult: ResolverTypeWrapper<ResolversUnionTypes<ResolversTypes>['CancelRunResult']>;
  ConflictError: ResolverTypeWrapper<ConflictError>;
  CreateWorkflowInput: CreateWorkflowInput;
  CreateWorkflowResult: ResolverTypeWrapper<ResolversUnionTypes<ResolversTypes>['CreateWorkflowResult']>;
  DateTime: ResolverTypeWrapper<Scalars['DateTime']['output']>;
  ErrorCode: ErrorCode;
  FieldIssue: ResolverTypeWrapper<FieldIssue>;
  ID: ResolverTypeWrapper<Scalars['ID']['output']>;
  Int: ResolverTypeWrapper<Scalars['Int']['output']>;
  Mutation: ResolverTypeWrapper<Record<PropertyKey, never>>;
  NotFoundError: ResolverTypeWrapper<NotFoundError>;
  PageInfo: ResolverTypeWrapper<PageInfo>;
  Query: ResolverTypeWrapper<Record<PropertyKey, never>>;
  Run: ResolverTypeWrapper<RunModel>;
  RunConnection: ResolverTypeWrapper<Omit<RunConnection, 'edges'> & { edges: Array<ResolversTypes['RunEdge']> }>;
  RunEdge: ResolverTypeWrapper<Omit<RunEdge, 'node'> & { node: ResolversTypes['Run'] }>;
  RunState: RunState;
  StartRunInput: StartRunInput;
  StartRunResult: ResolverTypeWrapper<ResolversUnionTypes<ResolversTypes>['StartRunResult']>;
  Step: ResolverTypeWrapper<Step>;
  StepInput: StepInput;
  String: ResolverTypeWrapper<Scalars['String']['output']>;
  UnavailableError: ResolverTypeWrapper<UnavailableError>;
  UserError: ResolverTypeWrapper<ResolversInterfaceTypes<ResolversTypes>['UserError']>;
  ValidationError: ResolverTypeWrapper<ValidationError>;
  Workflow: ResolverTypeWrapper<WorkflowModel>;
  WorkflowConnection: ResolverTypeWrapper<Omit<WorkflowConnection, 'edges'> & { edges: Array<ResolversTypes['WorkflowEdge']> }>;
  WorkflowEdge: ResolverTypeWrapper<Omit<WorkflowEdge, 'node'> & { node: ResolversTypes['Workflow'] }>;
};

/** Mapping between all available schema types and the resolvers parents */
export type ResolversParentTypes = {
  Boolean: Scalars['Boolean']['output'];
  CancelRunResult: ResolversUnionTypes<ResolversParentTypes>['CancelRunResult'];
  ConflictError: ConflictError;
  CreateWorkflowInput: CreateWorkflowInput;
  CreateWorkflowResult: ResolversUnionTypes<ResolversParentTypes>['CreateWorkflowResult'];
  DateTime: Scalars['DateTime']['output'];
  FieldIssue: FieldIssue;
  ID: Scalars['ID']['output'];
  Int: Scalars['Int']['output'];
  Mutation: Record<PropertyKey, never>;
  NotFoundError: NotFoundError;
  PageInfo: PageInfo;
  Query: Record<PropertyKey, never>;
  Run: RunModel;
  RunConnection: Omit<RunConnection, 'edges'> & { edges: Array<ResolversParentTypes['RunEdge']> };
  RunEdge: Omit<RunEdge, 'node'> & { node: ResolversParentTypes['Run'] };
  StartRunInput: StartRunInput;
  StartRunResult: ResolversUnionTypes<ResolversParentTypes>['StartRunResult'];
  Step: Step;
  StepInput: StepInput;
  String: Scalars['String']['output'];
  UnavailableError: UnavailableError;
  UserError: ResolversInterfaceTypes<ResolversParentTypes>['UserError'];
  ValidationError: ValidationError;
  Workflow: WorkflowModel;
  WorkflowConnection: Omit<WorkflowConnection, 'edges'> & { edges: Array<ResolversParentTypes['WorkflowEdge']> };
  WorkflowEdge: Omit<WorkflowEdge, 'node'> & { node: ResolversParentTypes['Workflow'] };
};

export type CancelRunResultResolvers<ContextType = GraphQLContext, ParentType extends ResolversParentTypes['CancelRunResult'] = ResolversParentTypes['CancelRunResult']> = {
  __resolveType: TypeResolveFn<'ConflictError' | 'NotFoundError' | 'Run' | 'UnavailableError' | 'ValidationError', ParentType, ContextType>;
};

export type ConflictErrorResolvers<ContextType = GraphQLContext, ParentType extends ResolversParentTypes['ConflictError'] = ResolversParentTypes['ConflictError']> = {
  code?: Resolver<ResolversTypes['ErrorCode'], ParentType, ContextType>;
  message?: Resolver<ResolversTypes['String'], ParentType, ContextType>;
  state?: Resolver<ResolversTypes['RunState'], ParentType, ContextType>;
  __isTypeOf?: IsTypeOfResolverFn<ParentType, ContextType>;
};

export type CreateWorkflowResultResolvers<ContextType = GraphQLContext, ParentType extends ResolversParentTypes['CreateWorkflowResult'] = ResolversParentTypes['CreateWorkflowResult']> = {
  __resolveType: TypeResolveFn<'ValidationError' | 'Workflow', ParentType, ContextType>;
};

export interface DateTimeScalarConfig extends GraphQLScalarTypeConfig<ResolversTypes['DateTime'], any> {
  name: 'DateTime';
}

export type FieldIssueResolvers<ContextType = GraphQLContext, ParentType extends ResolversParentTypes['FieldIssue'] = ResolversParentTypes['FieldIssue']> = {
  message?: Resolver<ResolversTypes['String'], ParentType, ContextType>;
  path?: Resolver<ResolversTypes['String'], ParentType, ContextType>;
};

export type MutationResolvers<ContextType = GraphQLContext, ParentType extends ResolversParentTypes['Mutation'] = ResolversParentTypes['Mutation']> = {
  cancelRun?: Resolver<ResolversTypes['CancelRunResult'], ParentType, ContextType, RequireFields<MutationCancelRunArgs, 'runId'>>;
  createWorkflow?: Resolver<ResolversTypes['CreateWorkflowResult'], ParentType, ContextType, RequireFields<MutationCreateWorkflowArgs, 'input'>>;
  startRun?: Resolver<ResolversTypes['StartRunResult'], ParentType, ContextType, RequireFields<MutationStartRunArgs, 'input'>>;
};

export type NotFoundErrorResolvers<ContextType = GraphQLContext, ParentType extends ResolversParentTypes['NotFoundError'] = ResolversParentTypes['NotFoundError']> = {
  code?: Resolver<ResolversTypes['ErrorCode'], ParentType, ContextType>;
  id?: Resolver<ResolversTypes['ID'], ParentType, ContextType>;
  message?: Resolver<ResolversTypes['String'], ParentType, ContextType>;
  resource?: Resolver<ResolversTypes['String'], ParentType, ContextType>;
  __isTypeOf?: IsTypeOfResolverFn<ParentType, ContextType>;
};

export type PageInfoResolvers<ContextType = GraphQLContext, ParentType extends ResolversParentTypes['PageInfo'] = ResolversParentTypes['PageInfo']> = {
  endCursor?: Resolver<Maybe<ResolversTypes['String']>, ParentType, ContextType>;
  hasNextPage?: Resolver<ResolversTypes['Boolean'], ParentType, ContextType>;
};

export type QueryResolvers<ContextType = GraphQLContext, ParentType extends ResolversParentTypes['Query'] = ResolversParentTypes['Query']> = {
  run?: Resolver<Maybe<ResolversTypes['Run']>, ParentType, ContextType, RequireFields<QueryRunArgs, 'id'>>;
  runs?: Resolver<ResolversTypes['RunConnection'], ParentType, ContextType, RequireFields<QueryRunsArgs, 'first'>>;
  workflow?: Resolver<Maybe<ResolversTypes['Workflow']>, ParentType, ContextType, RequireFields<QueryWorkflowArgs, 'id'>>;
  workflows?: Resolver<ResolversTypes['WorkflowConnection'], ParentType, ContextType, RequireFields<QueryWorkflowsArgs, 'first'>>;
};

export type RunResolvers<ContextType = GraphQLContext, ParentType extends ResolversParentTypes['Run'] = ResolversParentTypes['Run']> = {
  cancelRequested?: Resolver<ResolversTypes['Boolean'], ParentType, ContextType>;
  completedSteps?: Resolver<Array<ResolversTypes['String']>, ParentType, ContextType>;
  createdAt?: Resolver<ResolversTypes['DateTime'], ParentType, ContextType>;
  error?: Resolver<Maybe<ResolversTypes['String']>, ParentType, ContextType>;
  finishedAt?: Resolver<Maybe<ResolversTypes['DateTime']>, ParentType, ContextType>;
  id?: Resolver<ResolversTypes['ID'], ParentType, ContextType>;
  startedAt?: Resolver<Maybe<ResolversTypes['DateTime']>, ParentType, ContextType>;
  state?: Resolver<ResolversTypes['RunState'], ParentType, ContextType>;
  totalSteps?: Resolver<ResolversTypes['Int'], ParentType, ContextType>;
  workflow?: Resolver<ResolversTypes['Workflow'], ParentType, ContextType>;
  __isTypeOf?: IsTypeOfResolverFn<ParentType, ContextType>;
};

export type RunConnectionResolvers<ContextType = GraphQLContext, ParentType extends ResolversParentTypes['RunConnection'] = ResolversParentTypes['RunConnection']> = {
  edges?: Resolver<Array<ResolversTypes['RunEdge']>, ParentType, ContextType>;
  pageInfo?: Resolver<ResolversTypes['PageInfo'], ParentType, ContextType>;
  totalCount?: Resolver<ResolversTypes['Int'], ParentType, ContextType>;
};

export type RunEdgeResolvers<ContextType = GraphQLContext, ParentType extends ResolversParentTypes['RunEdge'] = ResolversParentTypes['RunEdge']> = {
  cursor?: Resolver<ResolversTypes['String'], ParentType, ContextType>;
  node?: Resolver<ResolversTypes['Run'], ParentType, ContextType>;
};

export type StartRunResultResolvers<ContextType = GraphQLContext, ParentType extends ResolversParentTypes['StartRunResult'] = ResolversParentTypes['StartRunResult']> = {
  __resolveType: TypeResolveFn<'NotFoundError' | 'Run' | 'UnavailableError' | 'ValidationError', ParentType, ContextType>;
};

export type StepResolvers<ContextType = GraphQLContext, ParentType extends ResolversParentTypes['Step'] = ResolversParentTypes['Step']> = {
  id?: Resolver<ResolversTypes['ID'], ParentType, ContextType>;
  type?: Resolver<ResolversTypes['String'], ParentType, ContextType>;
};

export type UnavailableErrorResolvers<ContextType = GraphQLContext, ParentType extends ResolversParentTypes['UnavailableError'] = ResolversParentTypes['UnavailableError']> = {
  code?: Resolver<ResolversTypes['ErrorCode'], ParentType, ContextType>;
  message?: Resolver<ResolversTypes['String'], ParentType, ContextType>;
  __isTypeOf?: IsTypeOfResolverFn<ParentType, ContextType>;
};

export type UserErrorResolvers<ContextType = GraphQLContext, ParentType extends ResolversParentTypes['UserError'] = ResolversParentTypes['UserError']> = {
  __resolveType: TypeResolveFn<'ConflictError' | 'NotFoundError' | 'UnavailableError' | 'ValidationError', ParentType, ContextType>;
};

export type ValidationErrorResolvers<ContextType = GraphQLContext, ParentType extends ResolversParentTypes['ValidationError'] = ResolversParentTypes['ValidationError']> = {
  code?: Resolver<ResolversTypes['ErrorCode'], ParentType, ContextType>;
  issues?: Resolver<Array<ResolversTypes['FieldIssue']>, ParentType, ContextType>;
  message?: Resolver<ResolversTypes['String'], ParentType, ContextType>;
  __isTypeOf?: IsTypeOfResolverFn<ParentType, ContextType>;
};

export type WorkflowResolvers<ContextType = GraphQLContext, ParentType extends ResolversParentTypes['Workflow'] = ResolversParentTypes['Workflow']> = {
  createdAt?: Resolver<ResolversTypes['DateTime'], ParentType, ContextType>;
  description?: Resolver<Maybe<ResolversTypes['String']>, ParentType, ContextType>;
  id?: Resolver<ResolversTypes['ID'], ParentType, ContextType>;
  lastRun?: Resolver<Maybe<ResolversTypes['Run']>, ParentType, ContextType>;
  name?: Resolver<ResolversTypes['String'], ParentType, ContextType>;
  runCount?: Resolver<ResolversTypes['Int'], ParentType, ContextType>;
  runs?: Resolver<ResolversTypes['RunConnection'], ParentType, ContextType, RequireFields<WorkflowRunsArgs, 'first'>>;
  steps?: Resolver<Array<ResolversTypes['Step']>, ParentType, ContextType>;
  __isTypeOf?: IsTypeOfResolverFn<ParentType, ContextType>;
};

export type WorkflowConnectionResolvers<ContextType = GraphQLContext, ParentType extends ResolversParentTypes['WorkflowConnection'] = ResolversParentTypes['WorkflowConnection']> = {
  edges?: Resolver<Array<ResolversTypes['WorkflowEdge']>, ParentType, ContextType>;
  pageInfo?: Resolver<ResolversTypes['PageInfo'], ParentType, ContextType>;
  totalCount?: Resolver<ResolversTypes['Int'], ParentType, ContextType>;
};

export type WorkflowEdgeResolvers<ContextType = GraphQLContext, ParentType extends ResolversParentTypes['WorkflowEdge'] = ResolversParentTypes['WorkflowEdge']> = {
  cursor?: Resolver<ResolversTypes['String'], ParentType, ContextType>;
  node?: Resolver<ResolversTypes['Workflow'], ParentType, ContextType>;
};

export type Resolvers<ContextType = GraphQLContext> = {
  CancelRunResult?: CancelRunResultResolvers<ContextType>;
  ConflictError?: ConflictErrorResolvers<ContextType>;
  CreateWorkflowResult?: CreateWorkflowResultResolvers<ContextType>;
  DateTime?: GraphQLScalarType;
  FieldIssue?: FieldIssueResolvers<ContextType>;
  Mutation?: MutationResolvers<ContextType>;
  NotFoundError?: NotFoundErrorResolvers<ContextType>;
  PageInfo?: PageInfoResolvers<ContextType>;
  Query?: QueryResolvers<ContextType>;
  Run?: RunResolvers<ContextType>;
  RunConnection?: RunConnectionResolvers<ContextType>;
  RunEdge?: RunEdgeResolvers<ContextType>;
  StartRunResult?: StartRunResultResolvers<ContextType>;
  Step?: StepResolvers<ContextType>;
  UnavailableError?: UnavailableErrorResolvers<ContextType>;
  UserError?: UserErrorResolvers<ContextType>;
  ValidationError?: ValidationErrorResolvers<ContextType>;
  Workflow?: WorkflowResolvers<ContextType>;
  WorkflowConnection?: WorkflowConnectionResolvers<ContextType>;
  WorkflowEdge?: WorkflowEdgeResolvers<ContextType>;
};

