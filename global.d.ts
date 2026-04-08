declare const Component: {
  (config: {
    data?: { [key: string]: any };
    props?: { [key: string]: any };
    methods?: { [key: string]: (...args: any[]) => any };
    onInit?: () => void;
    didMount?: () => void;
    didUpdate?: () => void;
    didUnmount?: () => void;
  }): void;
};
