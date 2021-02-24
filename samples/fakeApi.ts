import * as _ from 'lodash';
import express = require('express');

var people = [
    {
        id: 1,
        firstName: 'Henrik',
        lastName: 'Joreteg',
        coolnessFactor: 11
    },
    {
        id: 2,
        firstName: 'Bob',
        lastName: 'Saget',
        coolnessFactor: 2
    },
    {
        id: 3,
        firstName: 'Larry',
        lastName: 'King',
        coolnessFactor: 4
    },
    {
        id: 4,
        firstName: 'Diana',
        lastName: 'Ross',
        coolnessFactor: 6
    },
    {
        id: 5,
        firstName: 'Crazy<script>alert()</script>',
        lastName: 'Dave',
        coolnessFactor: 8
    },
    {
        id: 6,
        firstName: 'Larry',
        lastName: 'Johannson',
        coolnessFactor: 4
    }
];
var id = 7;

function get(id) {
    return _.find(people, {id: parseInt(id + '', 10)});
}

export var list = function (req: express.Request, res: express.Response) {
    res.send(people);
};

export var add = function (req: express.Request, res: express.Response) {
    var person = req.body;
    person.id = id++;
    people.push(person);
    res.status(201).send(person);
};

export var gets = function (req: express.Request, res: express.Response) {
    var found = get(req.params.id);
    res.status(found ? 200 : 404);
    res.send(found);
};

export var deletes = function (req: express.Request, res: express.Response) {
    var found = get(req.params.id);
    if (found) people = _.without(people, found);
    res.status(found ? 200 : 404);
    res.send(found);
};

export var update = function (req: express.Request, res: express.Response) {
    var found = get(req.params.id);
    if (found) _.extend(found, req.body);
    res.status(found ? 200 : 404);
    res.send(found);
};