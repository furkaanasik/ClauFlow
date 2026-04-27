export interface Translations {
  landing: {
    tagline: string;
    subtitle: string;
    cta: string;
  };
  header: {
    wsConnected: string;
    wsConnecting: string;
    themeToLight: string;
    themeToDark: string;
    githubConnected: string;
    githubConnect: string;
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
    diffButton: string;
    openDiffTitle: string;
    openOnGithubTitle: string;
  };
  addTask: {
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
  };
  board: {
    loadError: string;
    agentStarted: string;
    columns: {
      todo: string;
      doing: string;
      review: string;
      done: string;
    };
    emptyStates: {
      todo:   { title: string; hint: string };
      doing:  { title: string; hint: string };
      review: { title: string; hint: string };
      done:   { title: string; hint: string };
    };
    searchPlaceholder: string;
    loadingTasks: string;
    noSelection: string;
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
  };
  taskDetail: {
    titlePlaceholder: string;
    closeLabel: string;
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
    commentsLabel: string;
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
    branchLabel: string;
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
  };
  projectDetail: {
    title: string;
    editProject: string;
    projectName: string;
    projectDescription: string;
    projectAiPrompt: string;
    projectRepoPath: string;
    projectDefaultBranch: string;
    saveChanges: string;
    saving: string;
    dangerZone: string;
    deleteFromGithub: string;
    deleteFromKanban: string;
    confirmDeleteGithub: string;
    confirmDeleteKanban: string;
    openInGithub: string;
    activeTasksBlockPath: string;
    progress: string;
    taskCounts: string;
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
}
