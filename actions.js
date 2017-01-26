/**
 *  Functions to find actions and evaluate them
 */

const R = require('ramda');
const { nextTick} = require('async');
const debug = require('debug')('botmaster:fulfill:actions');
const render = require('posthtml-render');

// ramda-style utils for procesing action arrays
//const defaultToString = R.defaultTo('');
//const cleanString = R.compose(R.trim, defaultToString);
const setName = (val, key) => R.set(R.lensProp('name'), key)(val);
const indexActionName = R.mapObjIndexed(setName);
const toArray = R.compose(R.values, indexActionName);
const checkArray = actions => Array.isArray(actions) ? actions: toArray(actions);
const actionApplies = (tree, action) => R.find(R.propEq('tag', action.name), tree);
const getPendingActions = (tree, actions) => R.filter(R.curry(actionApplies)(tree), actions);
const mapToNames = R.map(R.prop('name'));
const getPendingActionNames = (tree, actions) => R.compose(mapToNames, R.curry(getPendingActions)(tree))(actions);
const isPendingActions = (tree, actions) => getPendingActionNames(tree, checkArray(actions)).length > 0;
//const getPendingActionSelectors = (tree, actions) => R.compose(R.join(', '), R.curry(getPendingActionNames)(tree))(actions);
const seriesActions = R.filter(R.prop('series'));
const parallelActions = R.filter(R.compose(R.not, R.prop('series')));
const isSync = R.allPass([x => !R.isNil(x), R.anyPass([R.is(String), R.is(Number)])]);
const clearNodes = (start, end, tree) => R.range(start, end).forEach(i => { tree[i] = '';});

// get an object specifying serial and parallal tasks and their async task and promise subtypes
const getTasks = (tree, actions, context) => {
    const tasks = evalActions(tree, actions, context);
    return {
        series: R.compose(R.map(actionTask(context, tree)), seriesActions)(tasks),
        parallel: R.compose(R.map(actionTask(context, tree)), parallelActions)(tasks)
    };
};


// create an async task by taking the "task" spec which specifies a certain action
const actionTask = (context, tree) => task => cb => {
    task.params.context = context;
    const internalCallback = (error, response) => {
        debug(`${task.name} ${task.index} got a response ${response}`);
        task.response = response || '';
        evalResponse(tree, task);
        debug(`tree is now ${JSON.stringify(tree)}`);
        return cb(error, task);
    };
    try {
        const result = task.controller(task.params, internalCallback);
        if (result && typeof result.then == 'function') {
            debug(`${task.name} controller is a promise`);
            result
                .then( response => internalCallback(null, response))
                .catch( internalCallback );
        } else if (isSync(result)) {
            debug(`${task.name} controller is sync`);
            nextTick( () => internalCallback(null, result) );
        } else {
            debug(`${task.name} controller is async`);
        }
    } catch (err) {
        nextTick( () => cb(err) );
    }
};

// get a list of all action tags of a particular type along with their params
const evalActions = (tree, actions, context, tasks = []) => {
    tree.forEach( (el, index) => {
        if (el && R.has(el.tag, actions))
            tasks.push(R.merge(
                actions[el.tag],
                {
                    params: R.merge(
                        context,
                        {
                            index,
                            attributes: el.attrs || {},
                            get tag() {
                                return render(el);
                            },
                            get content() {
                                return render(el.content);
                            },
                            get before() {
                                return render(tree.slice(0, index));
                            },
                            get after() {
                                return render(tree.slice(index + 1));
                            }
                        }
                    ),
                    index,
                    name: el.tag,
                    el
                })
            );
    });
    debug(`Got ${tasks.length} tasks`);
    return tasks;
};


// update the cheerio object with the responses from a particular action
const evalResponse = (tree, task) => {
    if (typeof task.replace == 'function')
        task.replace(tree, task);
    else {
        switch (task.replace) {
            case 'before':
                clearNodes(0, task.index, tree);
                tree[task.index] = task.response;
                break;
            case 'after':
                clearNodes(task.index, tree.length, tree);
                tree[task.index] = task.response;
                break;
            case 'all':
                tree = [task.response];
                break;
            default:
                tree[task.index] = task.response;

        }
    }
};




module.exports = {
    getTasks,
    isPendingActions
};
