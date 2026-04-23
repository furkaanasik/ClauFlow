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
  };
}
