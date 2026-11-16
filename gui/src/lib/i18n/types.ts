/** Team editor validation codes (core `teamRolesSchema` messages + client-only checks). */
export type TeamValidationCode = "roles_min" | "roles_max" | "duplicate_kind" | "duplicate_role_id" | "qa_requires_developer" | "qa_before_developer" | "advisor_below_model" | "haiku_advisor" | "invalid_model" | "invalid_skill_id" | "duplicate_tool" | "duplicate_skill" | "tools_min" | "skills_max" | "name_required" | "team_name_required" | "generic";

/** Core error codes (plan §5.4) the GUI translates; see `lib/errorText.ts`. */
export type ErrorCode =
  | "repo_busy"
  | "task_running"
  | "no_branch"
  | "aborted_by_user"
  | "aborted_while_awaiting_approval"
  | "aborted_orphan"
  | "server_restart"
  | "prompt_too_large"
  | "pr_merge_failed"
  | "stuck_stalled"
  | "stuck_round_limit"
  | "stuck_budget"
  | "merge_conflict"
  | "merge_failed"
  | "pr_already_merged"
  | "diff_failed"
  | "project_not_found"
  | "repo_path_not_absolute"
  | "repo_path_too_shallow"
  | "repo_path_not_git"
  | "invalid_repo_name"
  | "invalid_slug"
  | "slug_in_use"
  | "target_path_not_absolute"
  | "target_path_not_empty"
  | "project_path_exists"
  | "project_id_required"
  | "invalid_pr_number"
  | "github_not_authenticated"
  | "task_done"
  | "active_tasks_block_path_change"
  | "not_found"
  | "invalid_body"
  | "base_branch_missing"
  | "gh_missing"
  | "git_checkout_failed"
  | "git_push_failed"
  | "pr_create_failed"
  | "claude_exit"
  | "run_failed"
  | "task_in_review"
  | "dependency_cycle"
  | "dependency_self"
  | "dependency_not_found"
  | "dependency_cross_project"
  | "dependencies_locked"
  | "too_many_dependencies"
  | "aborted_while_waiting"
  | "not_waiting"
  | "dependencies_unmet"
  | "stash_not_found"
  | "stash_conflict"
  | "worktree_dirty"
  | "role_timeout";

export interface Translations {
  errors: Record<ErrorCode, string>;
  landing: {
    tagline: string;
    subtitle: string;
    cta: string;
    ctaSecondary: string;
    navBoard: string;
    navGithub: string;
    eyebrow: string;
    titleA: string;
    titleB: string;
    titleC: string;
    sceneLabel: string;
    scrollHint: string;
    stationsLabel: string;
    fallbackNote: string;
    stations: Record<"todo" | "doing" | "review" | "done", { name: string; note: string; body: string }>;
    how: {
      eyebrow: string;
      title: string;
      titleAccent: string;
      body: string;
      steps: Record<"drag" | "comment" | "merge", { verb: string; title: string; body: string }>;
    };
    closing: { eyebrow: string; title: string; titleAccent: string; cta: string };
    footer: { tagline: string; stack: string };
  };
  common: {
    close: string;
    dismiss: string;
    remove: string;
    toastSuccess: string;
    toastError: string;
    toastInfo: string;
  };
  styleguide: {
    title: string;
    subtitle: string;
    viewLabel: string;
    modeSplit: string;
    modeCream: string;
    modeNight: string;
    cream: string;
    night: string;
    colors: string;
    type: string;
    buttons: string;
    pills: string;
    chips: string;
    segmented: string;
    panels: string;
    meters: string;
    tabs: string;
    inputs: string;
    keys: string;
    avatars: string;
    overlays: string;
    legacy: string;
    cards: string;
  };
  shell: {
    expandRail: string;
    collapseRail: string;
    views: string;
    switchProject: string;
    noProjectSelected: string;
    noBranch: string;
    dirty: string;
    clean: string;
    live: string;
    offline: string;
    searchLabel: string;
    switchLang: string;
    core: { runningOne: string; idle: string; running: string };
    home: string;
    viewNames: {
      board: string;
      list: string;
      factory: string;
      insights: string;
    };
    openMenu: string;
    closeMenu: string;
  };
  header: {
    wsConnected: string;
    wsConnecting: string;
    themeToLight: string;
    themeToDark: string;
    githubConnected: string;
  };
  sidebar: {
    title: string;
    searchPlaceholder: string;
    emptySearch: string;
    emptyAll: string;
    newProject: string;
    plannerRunning: string;
    plannerError: string;
  };
  taskCard: {
    openDiffTitle: string;
    openOnGithubTitle: string;
    cancelQueuedTitle: string;
    queued: string;
    merged: string;
    subtasks: string;
    cost: string;
    overBudget: string;
    subtaskOf: string;
    dragLocked: string;
    /** Review card of a task whose branch lives only in the local repo (no remote, no PR). */
    localBranch: string;
    localBranchTitle: (branch: string) => string;
    agentLog: string;
    logEmpty: string;
    openLog: string;
    /** zincir: chain badge on a card that waits for one task ("Waiting for CLF-2"). */
    waitingOne: (key: string) => string;
    /** zincir: chain badge for several unmet dependencies. */
    waitingMany: (n: number) => string;
    /** zincir: first line of the badge tooltip (the list of dependencies follows). */
    waitingTitle: string;
    /** zincir: badge when a dependency failed, got stuck or was aborted (§3/11). */
    blockerProblem: (key: string) => string;
    /** zincir: pill on a waiting card (in Doing, no run yet). */
    waitingDeps: string;
    cancelWaitingTitle: string;
    /** zincir E5: pill on a waiting card whose dependencies are all done. */
    readyToStart: string;
    agentSteps: {
      idle: string;
      branching: string;
      running: string;
      pushing: string;
      pr_opening: string;
      awaiting_approval: string;
      waiting_deps: string;
      done: string;
      error: string;
    };
  };
  addTask: {
    budgetLabel: string;
    optional: string;
    budgetPlaceholder: string;
    modalHint: string;
    modalTitle: string;
    titleLabel: string;
    titlePlaceholder: string;
    priorityLabel: string;
    descriptionLabel: string;
    descriptionPlaceholder: string;
    analysisLabel: string;
    analysisHint: string;
    analysisPlaceholder: string;
    errorNoProject: string;
    errorNoTitle: string;
    errorGeneric: string;
    successToast: string;
    cancel: string;
    submit: string;
    submitting: string;
    priorities: {
      low: string;
      medium: string;
      high: string;
      critical: string;
    };
  };
  newProject: {
    createGithubHint: string;
    modalHint: string;
    optional: string;
    modalTitle: string;
    nameLabel: string;
    namePlaceholder: string;
    repoPathLabel: string;
    defaultBranchLabel: string;
    createGithubLabel: string;
    repoNameLabel: string;
    visibilityLabel: string;
    visibilityPrivate: string;
    visibilityPublic: string;
    remoteLabel: string;
    errorRequired: string;
    githubWarningPrefix: string;
    close: string;
    cancel: string;
    submit: string;
    submitting: string;
    aiPromptLabel: string;
    aiPromptPlaceholder: string;
    slugLabel: string;
    slugPlaceholder: string;
    slugHint: string;
    slugError: string;
    browse: string;
    modeLabel: string;
    modeNew: string;
    modeClone: string;
    cloneHint: string;
    /** zincir F0.5: a 422 base_branch_missing names the branch the repo is on. */
    repoIsOn: (branch: string) => string;
    useDetected: string;
  };
  folderPicker: {
    title: string;
    hint: string;
    up: string;
    home: string;
    pathLabel: string;
    listLabel: string;
    showHidden: string;
    showHiddenLabel: string;
    newFolder: string;
    newFolderPlaceholder: string;
    create: string;
    cancelCreate: string;
    loading: string;
    empty: string;
    emptyHint: string;
    gitRepo: string;
    errorNotFound: string;
    errorForbidden: string;
    errorInvalid: string;
    errorExists: string;
    errorName: string;
    errorGeneric: string;
    retry: string;
    goHome: string;
    cancel: string;
    choose: string;
    keyHint: string;
  };
  board: {
    budgetToast: (ref: string, spent: string, budget: string) => string;
    title: string;
    hint: string;
    /** `hint` for a project without a remote (local review + merge). */
    hintLocal: string;
    noProject: { title: string; hint: string };
    stats: {
      label: string;
      total: string;
      done: string;
      running: string;
      cost: string;
      progress: string;
    };
    newTask: string;
    addTask: string;
    collapseColumn: string;
    expandColumn: string;
    needsConfirm: string;
    moveFailed: string;
    prMerged: string;
    /** Review → Done merged the local branch into base (no remote). */
    localMerged: string;
    /** Moved to Done without a merge (no branch, or not from Review). */
    movedDone: string;
    mergeConflictFiles: (files: string) => string;
    viewLabel: string;
    filters: {
      label: string;
      priority: string;
      tags: string;
      agentRunning: string;
      prOpen: string;
      clear: string;
      showing: string;
      noTags: string;
      emptyTitle: string;
      emptyHint: string;
    };
    list: {
      label: string;
      key: string;
      title: string;
      status: string;
      priority: string;
      cost: string;
      pr: string;
      updated: string;
      sortBy: string;
      none: string;
    };
    factory: {
      sceneLabel: string;
      fallbackNote: string;
      toBoard: string;
      toList: string;
      stationsLabel: string;
      focusStation: string;
      resetView: string;
      legendLabel: string;
      legend: { running: string; queued: string; error: string; budget: string };
      controlsHint: string;
      notes: Record<"todo" | "doing" | "review" | "done", string>;
      tooltip: { open: string; openList: string; error: string; budget: string; more: string };
    };
    loadError: string;
    /** A move to Doing was accepted; the run is queued (it may wait for the repo lock). */
    taskQueued: (key: string) => string;
    /** zincir: a move to Doing went into waiting; `deps` are the unmet dependency keys. */
    waitingToast: (key: string, deps: string[]) => string;
    /** zincir: `chain_advanced` toast ("CLF-2 merged → CLF-3 started"). */
    chainAdvanced: (from: string, started: string[], merged: boolean) => string;
    /** zincir E4: Review → Done confirmation. */
    mergeConfirm: {
      title: string;
      local: (branch: string, base: string) => string;
      pr: (n: number) => string;
      /** Review task without a branch: nothing to merge. */
      noMerge: string;
      dirty: string;
      starts: (n: number, keys: string[]) => string;
      confirm: string;
      cancel: string;
    };
    /** zincir E5: waiting tasks whose dependencies are met but did not start. */
    readyWaiting: (n: number) => string;
    readyWaitingStart: string;
    readyWaitingStarted: (n: number) => string;
    columns: {
      todo:   string;
      doing:  string;
      review: string;
      done:   string;
    };
    emptyStates: {
      todo:   { title: string; hint: string };
      doing:  { title: string; hint: string };
      review: { title: string; hint: string; hintLocal: string };
      done:   { title: string; hint: string };
    };
    searchPlaceholder: string;
    shortcuts: {
      title: string;
      focusSearch: string;
      newTask: string;
      openHelp: string;
      close: string;
    };
    manualMove: {
      title: string;
      descriptionTemplate: string;
      confirm: string;
      cancel: string;
    };
    planner: {
      label: string;
      title: string;
      body: string;
      elapsed: string;
      errorTitle: string;
      errorHint: string;
      dismiss: string;
      doneToast: string;
      errorToast: string;
      todoEmpty: { title: string; hint: string };
    };
  };
  taskDetail: {
    projectLabel: string;
    parentLabel: string;
    subtasksLabel: string;
    budgetLabel: string;
    budgetPerTask: string;
    budgetProjectDefault: string;
    budgetInputPlaceholder: string;
    budgetHint: string;
    budgetLimit: string;
    budgetExceeded: string;
    budgetUsed: string;
    budgetNoUsage: string;
    /** Budget ring scope: the latest team run (the task total is in the header). */
    budgetThisRun: string;
    /** Tooltip on CLI-reported costs (task header, role chips). */
    costReported: string;
    follow: string;
    abortFailed: string;
    agentLabel: string;
    createdLabel: string;
    updatedLabel: string;
    tabsLabel: string;
    logViewLabel: string;
    noLinks: string;
    editingBadge: string;
    lines: (n: number) => string;
    titlePlaceholder: string;
    descriptionLabel: string;
    descriptionPlaceholder: string;
    descriptionEmpty: string;
    analysisLabel: string;
    analysisPlaceholder: string;
    analysisEmpty: string;
    priorityLabel: string;
    tabDetails: string;
    tabLog: string;
    tabComments: string;
    /** Local changes tab (`git diff <base>...<branch>`), tasks without a PR. */
    tabChanges: string;
    changesFiles: (files: number) => string;
    changesLocalNote: (base: string) => string;
    changesTruncated: (base: string, branch: string) => string;
    changesEmpty: string;
    changesStatLabel: string;
    retryButton: string;
    restartButton: string;
    retryingButton: string;
    abortButton: string;
    abortingButton: string;
    confirmAbort: { title: string; description: string; confirm: string };
    queueWaiting: string;
    errorOccurred: string;
    agentStatus: {
      branching: string;
      running: string;
      pushing: string;
      pr_opening: string;
      done: string;
    };
    connectionsLabel: string;
    openPr: string;
    merged: string;
    mergeError: string;
    logsEmpty: string;
    logsErrorPrefix: string;
    toolTimelineTab: string;
    toolRawTab: string;
    toolTimelineEmpty: string;
    toolThinking: string;
    costTokens: string;
    cancelButton: string;
    saveButton: string;
    savingButton: string;
    deleteButton: string;
    deletingButton: string;
    editButton: string;
    confirmDelete: {
      title: string;
      description: string;
      confirm: string;
      cancel: string;
    };
    errors: {
      titleRequired: string;
      updateFailed: string;
      retryFailed: string;
      deleteFailed: string;
    };
    breakdownLabel: string;
    breakdownPromptPlaceholder: string;
    breakdownButton: string;
    breakdowning: string;
    breakdownDone: string;
    breakdownError: string;
    breakdownCancel: string;
    analysisFromSpec: string;
    /** zincir: the "Waiting on" section and its editor (§5.6). */
    dependsLabel: string;
    dependentsLabel: string;
    addDependency: string;
    removeDependency: (key: string) => string;
    dependsLockedHint: string;
    dependsEmpty: string;
    /** Log tab of a waiting task. */
    depsWaiting: (keys: string[]) => string;
    /** Agent panel button of a waiting task whose dependencies are met (E5). */
    startWaiting: string;
    analysisOpenTeam: string;
  };
  cloneModal: {
    targetDirLabel: string;
    targetDirPlaceholder: string;
    submit: string;
    submitting: string;
    errorPrefix: string;
    visibilityPrivate: string;
    connectHint: string;
    connect: string;
    searchPlaceholder: string;
    listLabel: string;
    retry: string;
    emptyAll: string;
    emptySearch: string;
  };
  prereqs: {
    envLabel: string;
    readyCount: string;
    title: string;
    allGood: string;
    missingOne: string;
    missingMany: string;
    found: string;
    missing: string;
    copy: string;
    copied: string;
    docs: string;
    rerun: string;
    checking: string;
    error: string;
    githubLabel: string;
    githubConnected: string;
    githubDisconnected: string;
    githubConnect: string;
  };
  claudeConfig: {
    loadError: string;
    newFile: string;
    unsaved: string;
    lines: (n: number) => string;
    viewLabel: string;
    paneSource: string;
    panePreview: string;
    cancel: string;
    tabLabel: string;
    segmentInstructions: string;
    segmentTeam: string;
    teamHint: string;
    instructionsHint: string;
    instructionsPlaceholder: string;
    instructionsEmpty: string;
    save: string;
    saving: string;
    revert: string;
    saved: string;
    saveError: string;
    commitHint: string;
    committed: string;
    commitSkipped: string;
    commitNoChanges: string;
    commitNotARepo: string;
    commitFailed: string;
    push: string;
    pushing: string;
    pushed: string;
    pushFailed: string;
    expand: string;
    collapse: string;
    viewSplit: string;
    viewEdit: string;
    viewPreview: string;
    previewEmpty: string;
  };
  claudeSkills: {
    modalHint: string;
    close: string;
    footerHint: string;
    listTitle: string;
    uninstall: string;
    enable: string;
    disable: string;
    enabled: string;
    disabled: string;
    emptyInstalled: string;
    loadError: string;
    enableError: string;
    disableError: string;
    uninstallError: string;
    confirmUninstallTitle: string;
    confirmUninstallDescription: string;
    cancel: string;
    scopeLocal: string;
    scopeProject: string;
    scopeUser: string;
  };
  insights: {
    eyebrow: string;
    noProjectTitle: string;
    backToBoard: string;
    errorTitle: string;
    retry: string;
    kpis: string;
    legendDone: string;
    legendError: string;
    tokensTotal: string;
    noRunsYet: string;
    tokInput: string;
    tokOutput: string;
    tokCacheRead: string;
    tokCacheWrite: string;
    statusError: string;
    title: string;
    subtitle: string;
    loading: string;
    noProject: string;
    exportButton: string;
    exportJson: string;
    exportCsv: string;
    statTasks: string;
    statCost: string;
    /** Cost tile footnote when the project planner spent something: "{v}". */
    statCostPlanning: string;
    /** Tooltip on node-type costs that include token estimates for older runs. */
    costEstimated: string;
    statCompletion: string;
    statCompletionSub: string;
    statAvgRunTime: string;
    statAvgRunTimeSub: string;
    sectionByNodeType: string;
    colNodeType: string;
    colRuns: string;
    colDone: string;
    colTokens: string;
    colUsd: string;
    colSuccess: string;
    sectionRecentTasks: string;
    emptyTasks: string;
    emptyTasksHint: string;
  };
  projectDetail: {
    nameRequired: string;
    updateFailed: string;
    deleteFailed: string;
    dangerHint: string;
    links: string;
    noRemote: string;
    planning: {
      planning: string;
      done: string;
      error: string;
    };
    localOnly: string;
    budgetDefaultShort: string;
    tabsLabel: string;
    unsaved: string;
    sectionIdentity: string;
    namePlaceholder: string;
    descriptionPlaceholder: string;
    sectionPlanner: string;
    aiPromptHint: string;
    aiPromptPlaceholder: string;
    sectionRepo: string;
    sectionBudget: string;
    budgetLabel: string;
    budgetHint: string;
    budgetPlaceholder: string;
    total: string;
    title: string;
    projectName: string;
    projectDescription: string;
    projectAiPrompt: string;
    projectRepoPath: string;
    projectDefaultBranch: string;
    saveChanges: string;
    saving: string;
    dangerZone: string;
    deleteFromKanban: string;
    confirmDeleteKanban: string;
    openInGithub: string;
    activeTasksBlockPath: string;
    progress: string;
    details: string;
    cancel: string;
    deleting: string;
    plannerErrorTitle: string;
    plannerErrorHint: string;
    stats: {
      todo: string;
      doing: string;
      review: string;
      done: string;
    };
  };
  toolTimeline: {
    calls: (n: number) => string;
    running: (n: number) => string;
    done: (n: number) => string;
    errors: (n: number) => string;
    args: string;
    result: string;
    statusOk: string;
    statusRun: string;
    statusErr: string;
    agent: string;
    mix: string;
    runTime: string;
    runTimeHint: string;
    toolTime: string;
    toolTimeHint: string;
  };
  comments: {
    queued: string;
    working: string;
    applied: string;
    failed: string;
    showLog: string;
    hideLog: string;
    emptyTitle: string;
    emptyHint: string;
    placeholder: string;
    composerLabel: string;
    sendHint: string;
    send: string;
    sending: string;
    sendFailed: string;
    yesterday: string;
    readOnly: string;
    runningReadOnly: string;
    you: string;
  };
  githubConnect: {
    title: string;
    intro: string;
    requesting: string;
    retry: string;
    step1: string;
    step2: string;
    copy: string;
    copied: string;
    linkUnavailable: string;
    waiting: string;
  };
  notifications: {
    title: string;
    browser: string;
    browserHint: string;
    blocked: string;
    enabled: string;
    grantedHint: string;
    notRequested: string;
    enable: string;
    toggle: string;
    taskError: (title: string) => string;
    taskErrorBody: string;
    taskDone: (title: string) => string;
    taskDoneBody: string;
    /** In-app toast when a run fails (the browser notification may be off or unseen). */
    runFailedToast: (ref: string, reason: string) => string;
    /** zincir D6: a dependency of a waiting task got into trouble (once per failure). */
    chainBlocked: (blocker: string, waiting: string[]) => string;
  };
  prs: {
    state: {
      OPEN: string;
      MERGED: string;
      CLOSED: string;
    };
    unknownAuthor: string;
    openOnGithub: string;
    mergeFailed: string;
    merge: string;
    merging: string;
    line: string;
    collapse: string;
    expand: string;
    viewed: string;
    markViewed: string;
    filesChanged: (n: number) => string;
    reviewProgress: string;
    allReviewed: string;
    reset: string;
    changedFiles: string;
    diffEmpty: string;
    confirmMergeTitle: string;
    confirmMergeDescription: string;
    cancel: string;
  };
  /** zincir E6 (plan §5.9): ClauFlow's stashes (project drawer, board pill, toast). */
  stashes: {
    title: (n: number) => string;
    reason: Record<"run" | "merge" | "comment" | "resolve", string>;
    restore: string;
    drop: string;
    dropConfirmTitle: string;
    dropConfirmBody: (label: string) => string;
    restored: string;
    dropped: string;
    files: (n: number) => string;
    boardPill: (n: number) => string;
    boardPillTitle: string;
    /** `key` = the task's display id, or null when the stash has no task. */
    createdToast: (key: string | null) => string;
  };
  team: {
    roles: Record<"ceo" | "analyst" | "developer" | "qa", string>;
    /** Card / badge activity while a role runs. */
    activity: Record<"ceo" | "analyst" | "developer" | "qa", string>;
    /** Appended to the developer/QA activity from round 2 on: "{n}". */
    roundSuffix: string;
    round: string;
    awaitingApproval: string;
    builtinNames: Record<"solo" | "yazilim_ekibi" | "hata_avi" | "kesif", string>;
    builtinDescriptions: Record<"solo" | "yazilim_ekibi" | "hata_avi" | "kesif", string>;
    artifactKinds: Record<"brief" | "spec" | "delivery" | "qa_report" | "stuck" | "summary", string>;
    runStatus: Record<"running" | "awaiting_approval" | "delivered" | "explored" | "stuck" | "error" | "aborted", string>;
    stopReasons: Record<"stalled" | "round_limit" | "budget" | "aborted" | "superseded" | "server_restart" | "timeout", string>;
    verdict: Record<"pass" | "fail", string>;
    picker: {
      label: string;
      hint: string;
      projectDefault: string;
      groupBuiltin: string;
      groupTemplates: string;
      groupProject: string;
      locked: string;
      loading: string;
      saveError: string;
      chainLabel: string;
      lockedDone: string;
    };
    editTeam: string;
    tabTeam: string;
    timeline: {
      label: string;
      empty: string;
      emptyHint: string;
      runSelect: string;
      runOption: string;
      teamLabel: string;
      qaRounds: string;
      totalCost: string;
      showMore: string;
      showLess: string;
      commit: string;
      tokens: string;
      working: string;
      stuckTitle: string;
      summaryTitle: string;
      system: string;
      edited: string;
      approved: string;
    };
    approval: {
      title: string;
      hint: string;
      specLabel: string;
      approve: string;
      approving: string;
      cancel: string;
      reset: string;
      confirmTitle: string;
      confirmDescription: string;
      confirm: string;
      keep: string;
      error: string;
      review: string;
    };
    editor: {
      title: string;
      listLabel: string;
      defaultBadge: string;
      builtinBadge: string;
      templateBadge: string;
      projectBadge: string;
      makeDefault: string;
      customize: string;
      customizeHint: string;
      copyName: string;
      readonlyBuiltin: string;
      readonlyTemplate: string;
      emptyProject: string;
      emptyTemplates: string;
      teamName: string;
      teamDescription: string;
      teamDescriptionPlaceholder: string;
      roles: string;
      rolesHint: string;
      addRole: string;
      addRoleNone: string;
      moveUp: string;
      moveDown: string;
      removeRole: string;
      /** Screen-reader announcement after a reorder: "{name}", "{n}". */
      roleMoved: string;
      /** Screen-reader announcement after removing a role: "{name}". */
      roleRemoved: string;
      save: string;
      saving: string;
      revert: string;
      unsaved: string;
      saved: string;
      saveError: string;
      saveAsTemplate: string;
      saveAsTemplateHint: string;
      saveFirst: string;
      templateSaved: string;
      delete: string;
      deleteTeamTitle: string;
      deleteTemplateTitle: string;
      deleteTeamDescription: string;
      deleteTemplateDescription: string;
      deleteConfirm: string;
      keep: string;
      deleteInUse: string;
      deleteError: string;
      loadError: string;
      actionError: string;
      roleName: string;
      instructions: string;
      instructionsHint: string;
      model: string;
      advisor: string;
      advisorNone: string;
      advisorHint: string;
      tools: string;
      toolsHint: string;
      skills: string;
      skillsHint: string;
      skillsSearch: string;
      skillsEmpty: string;
      skillsMore: string;
      skillsSelected: string;
      skillsNone: string;
      skillsLoading: string;
      skillsLoadError: string;
      skillsManager: string;
      skillRemove: string;
      skillUnknown: string;
      sourceUser: string;
      sourceProject: string;
      sourcePlugin: string;
      noInstructions: string;
      roleEditorEmpty: string;
      settingsTitle: string;
      defaultTeam: string;
      defaultTeamHint: string;
      qaRounds: string;
      qaRoundsHint: string;
      qaRoundsCustom: string;
      unlimited: string;
      specApproval: string;
      specApprovalHint: string;
      settingSaved: string;
      settingError: string;
      issues: string;
      discardTitle: string;
      discardDescription: string;
      discard: string;
      validation: Record<TeamValidationCode, string>;
    };
  };
}
